import { z } from 'zod';
import type { JSONSchema7 } from 'json-schema';
import type { Logger } from '../logger/v2/types.js';

/**
 * Convert Zod schema to JSON Schema format for tool parameters
 *
 */
export function convertZodSchemaToJsonSchema(
    zodSchema: z.ZodType,
    logger: Logger,
    io: 'input' | 'output' = 'input'
): JSONSchema7 {
    try {
        const converted = z.toJSONSchema(zodSchema, {
            io,
            target: 'draft-07',
            unrepresentable: 'any',
            // `format: "uuid"` already says it; zod's ~180-character uuid regex beside it
            // is repeated on every id field of every tool the model sees.
            override: ({ jsonSchema }) => {
                if (jsonSchema.format === 'uuid') {
                    delete jsonSchema.pattern;
                }
            },
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
