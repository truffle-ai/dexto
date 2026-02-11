import type { IConversationHistoryProvider } from './types.js';
import type { Database } from '../../storage/types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
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
    logger: IDextoLogger
): IConversationHistoryProvider {
    return new DatabaseHistoryProvider(sessionId, database, logger);
}
