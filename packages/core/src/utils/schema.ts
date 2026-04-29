import { z } from 'zod';
import type { JSONSchema7 } from 'json-schema';
import type { Logger } from '../logger/v2/types.js';

/**
 * Convert Zod schema to JSON Schema format for tool parameters
 *
 */
export function convertZodSchemaToJsonSchema(zodSchema: z.ZodType, logger: Logger): JSONSchema7 {
    try {
        const converted = z.toJSONSchema(zodSchema, {
            io: 'input',
            target: 'draft-07',
            unrepresentable: 'any',
        }) as unknown;
        if (converted && typeof converted === 'object') {
            return converted as JSONSchema7;
        }

        logger.warn('Failed to convert Zod schema to JSON Schema: conversion returned non-object');
    } catch (error) {
        logger.warn(
            `Failed to convert Zod schema to JSON Schema: ${error instanceof Error ? error.message : String(error)}`
        );
    }

    // Return basic object schema as fallback
    return {
        type: 'object',
        properties: {},
    };
}
