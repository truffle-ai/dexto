import { zodToJsonSchema } from 'zod-to-json-schema';
import { logger } from '../logger/index.js';

/**
 * Convert Zod schema to JSON Schema format for tool parameters
 */
export function convertZodSchemaToJsonSchema(zodSchema: any): any {
    try {
        // Use proper library for Zod to JSON Schema conversion
        return zodToJsonSchema(zodSchema);
    } catch (error) {
        logger.warn(
            `Failed to convert Zod schema to JSON Schema: ${error instanceof Error ? error.message : String(error)}`
        );
        // Return basic object schema as fallback
        return {
            type: 'object',
            properties: {},
        };
    }
}
