import { zodToJsonSchema } from 'zod-to-json-schema';
import type { IDextoLogger } from '../logger/v2/types.js';

/**
 * Convert Zod schema to JSON Schema format for tool parameters
 */
export function convertZodSchemaToJsonSchema(zodSchema: any, logger?: IDextoLogger): any {
    try {
        // Use proper library for Zod to JSON Schema conversion
        return zodToJsonSchema(zodSchema);
    } catch (error) {
        logger?.warn(
            `Failed to convert Zod schema to JSON Schema: ${error instanceof Error ? error.message : String(error)}`
        );
        // Return basic object schema as fallback
        return {
            type: 'object',
            properties: {},
        };
    }
}
