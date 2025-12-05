import { IMessageFormatter } from './types.js';
import { VercelMessageFormatter } from './vercel.js';
import type { IDextoLogger } from '@core/logger/v2/types.js';

/**
 * Creates a message formatter for the Vercel AI SDK.
 * All providers use the unified VercelMessageFormatter.
 */
export function createMessageFormatter(logger: IDextoLogger): IMessageFormatter {
    return new VercelMessageFormatter(logger);
}
