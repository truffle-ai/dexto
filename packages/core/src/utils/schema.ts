import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Logger } from '../logger/v2/types.js';

/**
 * Convert Zod schema to JSON Schema format for tool parameters
 *
 * TODO: Replace zod-to-json-schema with Zod v4 native JSON schema support
 * The zod-to-json-schema package is deprecated and adds ~19MB due to a packaging bug
 * (includes test files with full Zod copies in dist-test-v3 and dist-test-v4 folders).
 * Zod v4 has native toJsonSchema() support - migrate when upgrading to Zod v4.
 * See: https://github.com/StefanTerdell/zod-to-json-schema
 */
export function convertZodSchemaToJsonSchema(zodSchema: any, logger: Logger): any {
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
