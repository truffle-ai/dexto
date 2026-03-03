/**
 * Utility for generating unique IDs
 */

import { randomUUID } from 'crypto';

/**
 * Generate a unique message ID with a type prefix
 * @param type - The message type (user, system, error, tool, assistant, command)
 * @returns A unique ID string
 */
export function generateMessageId(type: string): string {
    return `${type}-${randomUUID()}`;
}
