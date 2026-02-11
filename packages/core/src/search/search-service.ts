import type { IDextoLogger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import type { Database } from '../storage/types.js';
import type { InternalMessage } from '../context/types.js';
import type {
    SearchOptions,
    SearchResult,
    SessionSearchResult,
    SearchResponse,
    SessionSearchResponse,
} from './types.js';

/**
 * Service for searching through conversation history
 * TODO: remove duplicate stuff related to session manager instead of directly using DB
 */
export class SearchService {
    private logger: IDextoLogger;

    constructor(
        private database: Database,
        logger: IDextoLogger
    ) {
        this.logger = logger.createChild(DextoLogComponent.SESSION);
    }

    /**
     * Search for messages across all sessions or within a specific session
     */
    async searchMessages(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
        const { sessionId, role, limit = 20, offset = 0 } = options;

        if (!query.trim()) {
            return {
                results: [],
                total: 0,
                hasMore: false,
                query,
                options,
            };
        }

        try {
            this.logger.debug(`Searching messages for query: "${query}"`, {
                sessionId,
                role,
                limit,
                offset,
            });

            const allResults: SearchResult[] = [];
            const sessionIds = sessionId ? [sessionId] : await this.getSessionIds();

            // Search through each session
            for (const sId of sessionIds) {
                const sessionResults = await this.searchInSession(query, sId, role);
                allResults.push(...sessionResults);
            }

            // Sort results by relevance (exact matches first, then by session activity)
            const sortedResults = this.sortResults(allResults, query);

            // Apply pagination
            const total = sortedResults.length;
            const paginatedResults = sortedResults.slice(offset, offset + limit);
            const hasMore = offset + limit < total;

            return {
                results: paginatedResults,
                total,
                hasMore,
                query,
                options,
            };
        } catch (error) {
            this.logger.error(
                `Error searching messages: ${error instanceof Error ? error.message : String(error)}`
            );
            return {
                results: [],
                total: 0,
                hasMore: false,
                query,
                options,
            };
        }
    }

    /**
     * Search for sessions that contain the query
     */
    async searchSessions(query: string): Promise<SessionSearchResponse> {
        if (!query.trim()) {
            return {
                results: [],
                total: 0,
                hasMore: false,
                query,
            };
        }

        try {
            this.logger.debug(`Searching sessions for query: "${query}"`);

            const sessionResults: SessionSearchResult[] = [];
            const sessionIds = await this.getSessionIds();

            // Search through each session and collect session-level results
            for (const sessionId of sessionIds) {
                const messageResults = await this.searchInSession(query, sessionId);

                if (messageResults.length > 0) {
                    const sessionMetadata = await this.getSessionMetadata(sessionId);
                    if (sessionMetadata) {
                        const firstMatch = messageResults[0];
                        if (firstMatch) {
                            sessionResults.push({
                                sessionId,
                                matchCount: messageResults.length,
                                firstMatch,
                                metadata: sessionMetadata,
                            });
                        }
                    }
                }
            }

            // Sort sessions by match count and recent activity
            const sortedResults = sessionResults.sort((a, b) => {
                // First by match count
                if (a.matchCount !== b.matchCount) {
                    return b.matchCount - a.matchCount;
                }
                // Then by recent activity
                return b.metadata.lastActivity - a.metadata.lastActivity;
            });

            return {
                results: sortedResults,
                total: sortedResults.length,
                hasMore: false,
                query,
            };
        } catch (error) {
            this.logger.error(
                `Error searching sessions: ${error instanceof Error ? error.message : String(error)}`
            );
            return {
                results: [],
                total: 0,
                hasMore: false,
                query,
            };
        }
    }

    /**
     * Search for messages within a specific session
     */
    private async searchInSession(
        query: string,
        sessionId: string,
        role?: string
    ): Promise<SearchResult[]> {
        const messagesKey = `messages:${sessionId}`;
        // TODO: Consider implementing pagination or using database search capabilities
        const MAX_MESSAGES_PER_SEARCH = 10000; // Configurable limit
        const messages = await this.database.getRange<InternalMessage>(
            messagesKey,
            0,
            MAX_MESSAGES_PER_SEARCH
        );

        const results: SearchResult[] = [];
        const lowerQuery = query.toLowerCase();

        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            if (!message) {
                continue;
            }

            // Skip if role filter doesn't match
            if (role && message.role !== role) {
                continue;
            }

            // Extract searchable text from message content
            const searchableText = this.extractSearchableText(message);
            if (!searchableText) {
                continue;
            }

            const lowerText = searchableText.toLowerCase();
            const matchIndex = lowerText.indexOf(lowerQuery);

            if (matchIndex !== -1) {
                const matchedText = searchableText.substring(matchIndex, matchIndex + query.length);
                const context = this.getContext(searchableText, matchIndex, query.length);

                results.push({
                    sessionId,
                    message,
                    matchedText,
                    context,
                    messageIndex: i,
                });
            }
        }

        return results;
    }

    /**
     * Extract searchable text from a message
     */
    private extractSearchableText(message: InternalMessage): string | null {
        if (!message.content) {
            return null;
        }

        if (typeof message.content === 'string') {
            return message.content;
        }

        if (Array.isArray(message.content)) {
            return message.content
                .filter((part) => part.type === 'text')
                .map((part) => ('text' in part ? part.text : ''))
                .join(' ');
        }

        return null;
    }

    /**
     * Get context around a match for preview
     */
    private getContext(
        text: string,
        matchIndex: number,
        matchLength: number,
        contextLength = 50
    ): string {
        const start = Math.max(0, matchIndex - contextLength);
        const end = Math.min(text.length, matchIndex + matchLength + contextLength);

        let context = text.substring(start, end);

        // Add ellipsis if we truncated
        if (start > 0) {
            context = '...' + context;
        }
        if (end < text.length) {
            context = context + '...';
        }

        return context;
    }

    /**
     * Sort search results by relevance
     */
    private sortResults(results: SearchResult[], query: string): SearchResult[] {
        const lowerQuery = query.toLowerCase();

        return results.sort((a, b) => {
            const aText = this.extractSearchableText(a.message)?.toLowerCase() || '';
            const bText = this.extractSearchableText(b.message)?.toLowerCase() || '';

            // Exact word matches score higher
            const aExactMatch =
                aText.includes(` ${lowerQuery} `) ||
                aText.startsWith(lowerQuery) ||
                aText.endsWith(lowerQuery);
            const bExactMatch =
                bText.includes(` ${lowerQuery} `) ||
                bText.startsWith(lowerQuery) ||
                bText.endsWith(lowerQuery);

            if (aExactMatch && !bExactMatch) return -1;
            if (!aExactMatch && bExactMatch) return 1;

            // Then by message index (more recent messages first)
            return b.messageIndex - a.messageIndex;
        });
    }

    /**
     * Get all session IDs
     */
    private async getSessionIds(): Promise<string[]> {
        const sessionKeys = await this.database.list('session:');
        return sessionKeys.map((key: string) => key.replace('session:', ''));
    }

    /**
     * Get session metadata
     */
    private async getSessionMetadata(sessionId: string): Promise<{
        createdAt: number;
        lastActivity: number;
        messageCount: number;
    }> {
        const sessionKey = `session:${sessionId}`;
        const sessionData = await this.database.get<{
            createdAt: number;
            lastActivity: number;
            messageCount: number;
        }>(sessionKey);

        if (!sessionData) {
            throw new Error(`Session metadata not found: ${sessionId}`);
        }
        return sessionData;
    }
}
