import type { InternalMessage } from '../context/types.js';

/**
 * Options for searching messages
 */
export interface SearchOptions {
    /** Limit search to a specific session */
    sessionId?: string;
    /** Filter by message role */
    role?: 'user' | 'assistant' | 'system' | 'tool';
    /** Maximum number of results to return */
    limit?: number;
    /** Offset for pagination */
    offset?: number;
}

/**
 * Result of a message search
 */
export interface SearchResult {
    /** Session ID where the message was found */
    sessionId: string;
    /** The message that matched the search */
    message: InternalMessage;
    /** The specific text that matched the search query */
    matchedText: string;
    /** Context around the match for preview */
    context: string;
    /** Index of the message within the session */
    messageIndex: number;
}

/**
 * Result of a session search
 */
export interface SessionSearchResult {
    /** Session ID */
    sessionId: string;
    /** Number of messages that matched in this session */
    matchCount: number;
    /** Preview of the first matching message */
    firstMatch: SearchResult;
    /** Session metadata */
    metadata: {
        createdAt: number;
        lastActivity: number;
        messageCount: number;
    };
}

/**
 * Response format for search API
 */
export interface SearchResponse {
    /** Array of search results */
    results: SearchResult[];
    /** Total number of results available */
    total: number;
    /** Whether there are more results beyond the current page */
    hasMore: boolean;
    /** Query that was searched */
    query: string;
    /** Options used for the search */
    options: SearchOptions;
}

/**
 * Response format for session search API
 */
export interface SessionSearchResponse {
    /** Array of session search results */
    results: SessionSearchResult[];
    /** Total number of sessions with matches */
    total: number;
    /** Whether there are more results beyond the current page */
    hasMore: boolean;
    /** Query that was searched */
    query: string;
}
