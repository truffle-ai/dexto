/**
 * Example Custom Tool Provider: DateTime Helper
 *
 * Demonstrates how to create a custom tool provider that registers
 * one or more tools with the Dexto agent.
 */

import { z } from 'zod';
import type { CustomToolProvider, ToolCreationContext } from '@dexto/core';
import type { InternalTool } from '@dexto/core';

// Define the configuration schema for this provider
const DateTimeToolConfigSchema = z
    .object({
        type: z.literal('datetime-helper'),
        defaultTimezone: z.string().optional().default('UTC'),
        includeMilliseconds: z.boolean().optional().default(false),
    })
    .strict();

type DateTimeToolConfig = z.output<typeof DateTimeToolConfigSchema>;

// Define the custom tool provider
export const dateTimeToolProvider: CustomToolProvider<'datetime-helper', DateTimeToolConfig> = {
    type: 'datetime-helper',
    configSchema: DateTimeToolConfigSchema,

    // Factory function that creates the tools
    create: (config: DateTimeToolConfig, context: ToolCreationContext): InternalTool[] => {
        const { logger } = context;

        logger.debug(`Creating datetime tools with timezone: ${config.defaultTimezone}`);

        // Define input schema type
        const getDateTimeInputSchema = z.object({
            timezone: z
                .string()
                .optional()
                .describe(
                    'Timezone (e.g., UTC, America/New_York). Defaults to configured timezone.'
                ),
            format: z
                .enum(['iso', 'unix', 'readable'])
                .optional()
                .default('iso')
                .describe(
                    'Output format: iso (ISO 8601), unix (timestamp), or readable (human-readable)'
                ),
        });
        type GetDateTimeInput = z.infer<typeof getDateTimeInputSchema>;

        return [
            // Tool 1: Get current date and time
            {
                id: 'get_datetime',
                description: 'Get the current date and time with timezone information',
                inputSchema: getDateTimeInputSchema,
                execute: async (input: unknown) => {
                    // Input is validated by the schema before execution
                    const validatedInput = input as GetDateTimeInput;
                    const tz = validatedInput.timezone || config.defaultTimezone;
                    const now = new Date();

                    let formatted: string;
                    switch (validatedInput.format) {
                        case 'unix':
                            formatted = config.includeMilliseconds
                                ? now.getTime().toString()
                                : Math.floor(now.getTime() / 1000).toString();
                            break;
                        case 'readable':
                            formatted = now.toLocaleString('en-US', { timeZone: tz });
                            break;
                        case 'iso':
                        default:
                            formatted = now.toISOString();
                    }

                    return {
                        datetime: formatted,
                        timezone: tz,
                        format: validatedInput.format,
                        timestamp: now.getTime(),
                    };
                },
            },

            // Tool 2: Calculate time difference
            (() => {
                const timeDiffInputSchema = z.object({
                    start: z
                        .string()
                        .describe('Start date/time (ISO 8601 string or Unix timestamp)'),
                    end: z
                        .string()
                        .optional()
                        .describe(
                            'End date/time (ISO 8601 string or Unix timestamp). Defaults to now.'
                        ),
                    unit: z
                        .enum(['milliseconds', 'seconds', 'minutes', 'hours', 'days'])
                        .optional()
                        .default('seconds')
                        .describe('Unit for the result'),
                });
                type TimeDiffInput = z.infer<typeof timeDiffInputSchema>;

                return {
                    id: 'time_diff',
                    description: 'Calculate the difference between two timestamps or dates',
                    inputSchema: timeDiffInputSchema,
                    execute: async (input: unknown) => {
                        // Input is validated by the schema before execution
                        const validatedInput = input as TimeDiffInput;
                        const startTime = new Date(validatedInput.start).getTime();
                        const endTime = validatedInput.end
                            ? new Date(validatedInput.end).getTime()
                            : Date.now();

                        const diffMs = Math.abs(endTime - startTime);

                        let result: number;
                        switch (validatedInput.unit) {
                            case 'seconds':
                                result = diffMs / 1000;
                                break;
                            case 'minutes':
                                result = diffMs / (1000 * 60);
                                break;
                            case 'hours':
                                result = diffMs / (1000 * 60 * 60);
                                break;
                            case 'days':
                                result = diffMs / (1000 * 60 * 60 * 24);
                                break;
                            case 'milliseconds':
                            default:
                                result = diffMs;
                        }

                        return {
                            difference: result,
                            unit: validatedInput.unit,
                            start: new Date(startTime).toISOString(),
                            end: new Date(endTime).toISOString(),
                        };
                    },
                };
            })(),
        ];
    },

    metadata: {
        displayName: 'DateTime Helper',
        description: 'Provides date and time utilities for the agent',
        category: 'utilities',
    },
};
