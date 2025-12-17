/**
 * Custom Tool Provider: Text Utilities
 *
 * This demonstrates building a custom provider from scratch that gets bundled
 * into the base image. When users import @dexto/image-local, these tools
 * are automatically available to their agents.
 */

import { z } from 'zod';
import type { CustomToolProvider, ToolCreationContext, InternalTool } from '@dexto/core';

// Configuration schema for this provider
const TextUtilsConfigSchema = z
    .object({
        type: z.literal('text-utils'),
        maxLength: z.number().optional().default(10000).describe('Maximum text length to process'),
    })
    .strict();

type TextUtilsConfig = z.output<typeof TextUtilsConfigSchema>;

/**
 * Text utilities tool provider
 *
 * This provider registers multiple text manipulation tools with the agent.
 * When bundled into an image, these tools become available automatically.
 */
export const textUtilsProvider: CustomToolProvider<'text-utils', TextUtilsConfig> = {
    type: 'text-utils',
    configSchema: TextUtilsConfigSchema,

    create: (config: TextUtilsConfig, context: ToolCreationContext): InternalTool[] => {
        const { logger } = context;

        logger.debug(`Creating text utilities with maxLength: ${config.maxLength}`);

        return [
            // Tool 1: Count words in text
            {
                id: 'count_words',
                description: 'Count the number of words in a text string',
                inputSchema: z.object({
                    text: z.string().describe('The text to analyze'),
                }),
                execute: async (input: unknown) => {
                    const { text } = input as { text: string };

                    if (text.length > config.maxLength) {
                        throw new Error(
                            `Text exceeds maximum length of ${config.maxLength} characters`
                        );
                    }

                    // Split on whitespace and filter empty strings
                    const words = text
                        .trim()
                        .split(/\s+/)
                        .filter((w) => w.length > 0);

                    return {
                        wordCount: words.length,
                        characterCount: text.length,
                        characterCountNoSpaces: text.replace(/\s/g, '').length,
                    };
                },
            },

            // Tool 2: Transform text case
            {
                id: 'transform_case',
                description: 'Transform text to different cases (uppercase, lowercase, title case)',
                inputSchema: z.object({
                    text: z.string().describe('The text to transform'),
                    format: z
                        .enum(['uppercase', 'lowercase', 'titlecase'])
                        .describe('Target format'),
                }),
                execute: async (input: unknown) => {
                    const { text, format } = input as { text: string; format: string };

                    if (text.length > config.maxLength) {
                        throw new Error(
                            `Text exceeds maximum length of ${config.maxLength} characters`
                        );
                    }

                    let result: string;
                    switch (format) {
                        case 'uppercase':
                            result = text.toUpperCase();
                            break;
                        case 'lowercase':
                            result = text.toLowerCase();
                            break;
                        case 'titlecase':
                            result = text
                                .toLowerCase()
                                .split(' ')
                                .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                                .join(' ');
                            break;
                        default:
                            result = text;
                    }

                    return {
                        original: text,
                        transformed: result,
                        format: format,
                    };
                },
            },

            // Tool 3: Reverse text
            {
                id: 'reverse_text',
                description: 'Reverse the characters in a text string',
                inputSchema: z.object({
                    text: z.string().describe('The text to reverse'),
                }),
                execute: async (input: unknown) => {
                    const { text } = input as { text: string };

                    if (text.length > config.maxLength) {
                        throw new Error(
                            `Text exceeds maximum length of ${config.maxLength} characters`
                        );
                    }

                    const reversed = text.split('').reverse().join('');

                    return {
                        original: text,
                        reversed: reversed,
                        length: text.length,
                    };
                },
            },
        ];
    },

    metadata: {
        displayName: 'Text Utilities',
        description: 'Basic text manipulation and analysis tools',
        category: 'utilities',
    },
};
