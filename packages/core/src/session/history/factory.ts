import type { ConversationHistoryProvider } from './types.js';
import type { Database } from '../../storage/types.js';
import type { Logger } from '../../logger/v2/types.js';
import { DatabaseHistoryProvider } from './database.js';

/**
 * Create a history provider directly with database backend
 * @param database Database instance
 * @param sessionId Session ID
 * @param logger Logger instance for logging
 */
export function createDatabaseHistoryProvider(
    database: Database,
    sessionId: string,
    logger: Logger
): ConversationHistoryProvider {
    return new DatabaseHistoryProvider(sessionId, database, logger);
}
