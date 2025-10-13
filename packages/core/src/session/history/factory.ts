import type { IConversationHistoryProvider } from './types.js';
import type { Database } from '@core/storage/types.js';
import { DatabaseHistoryProvider } from './database.js';

/**
 * Create a history provider directly with database backend
 */
export function createDatabaseHistoryProvider(
    database: Database,
    sessionId: string
): IConversationHistoryProvider {
    return new DatabaseHistoryProvider(sessionId, database);
}
