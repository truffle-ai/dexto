import type { IDextoLogger } from '@core/logger/v2/types.js';
import { DextoLogComponent } from '@core/logger/v2/types.js';
import type { Database } from '@core/storage/types.js';
import { SessionError } from '../errors.js';
import type { InternalMessage } from '@core/context/types.js';
import type { IConversationHistoryProvider } from './types.js';

/**
 * History provider that works directly with DatabaseBackend.
 * Handles message-specific operations and key formatting internally.
 *
 * TODO: Add in-memory caching to reduce database queries.
 * Cache should be invalidated on writes and persist across LLM switches.
 * Consider caching strategy:
 * - Load cache on first getHistory() call
 * - Update cache optimistically on saveMessage()
 * - Clear cache on clearHistory()
 * This will significantly improve performance for sessions with many messages.
 */
export class DatabaseHistoryProvider implements IConversationHistoryProvider {
    private logger: IDextoLogger;

    constructor(
        private sessionId: string,
        private database: Database,
        logger: IDextoLogger
    ) {
        this.logger = logger.createChild(DextoLogComponent.SESSION);
    }

    async getHistory(): Promise<InternalMessage[]> {
        const key = this.getMessagesKey();
        try {
            // Get all messages for this session in chronological order (oldest first)
            const messages = await this.database.getRange<InternalMessage>(key, 0, 1000);

            this.logger.debug(
                `DatabaseHistoryProvider: Retrieved ${messages.length} messages for session ${this.sessionId}`
            );

            return messages;
        } catch (error) {
            this.logger.error(
                `DatabaseHistoryProvider: Error retrieving messages for session ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`
            );
            return [];
        }
    }

    async saveMessage(message: InternalMessage): Promise<void> {
        const key = this.getMessagesKey();
        try {
            await this.database.append(key, message);

            // Create safe content preview for logging
            let contentPreview = '[no content]';
            if (message.content) {
                if (typeof message.content === 'string') {
                    contentPreview =
                        message.content.length > 100
                            ? `${message.content.substring(0, 100)}...`
                            : message.content;
                } else if (Array.isArray(message.content)) {
                    contentPreview = `[${message.content.length} parts]`;
                }
            }

            this.logger.debug(
                `DatabaseHistoryProvider: Saved message for session ${this.sessionId}`,
                {
                    role: message.role,
                    content: contentPreview,
                }
            );
        } catch (error) {
            this.logger.error(
                `DatabaseHistoryProvider: Error saving message for session ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw SessionError.storageFailed(
                this.sessionId,
                'save message',
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    async clearHistory(): Promise<void> {
        const key = this.getMessagesKey();
        try {
            await this.database.delete(key);
            this.logger.debug(
                `DatabaseHistoryProvider: Cleared history for session ${this.sessionId}`
            );
        } catch (error) {
            this.logger.error(
                `DatabaseHistoryProvider: Error clearing session ${this.sessionId}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw SessionError.resetFailed(
                this.sessionId,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    private getMessagesKey(): string {
        return `messages:${this.sessionId}`;
    }
}
