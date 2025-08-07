import type { IConversationHistoryProvider } from './types.js';
import type { DatabaseBackend } from '@core/storage/backend/types.js';
import { DatabaseHistoryProvider } from './database.js';

/**
 * Create a history provider directly with database backend
 */
export function createDatabaseHistoryProvider(
    database: DatabaseBackend,
    sessionId: string
): IConversationHistoryProvider {
    return new DatabaseHistoryProvider(sessionId, database);
}
