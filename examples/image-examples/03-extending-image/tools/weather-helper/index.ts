/**
 * Custom Weather Tool Provider
 *
 * This demonstrates how to create a custom tool that extends an official image.
 */

import { z } from 'zod';
import type { CustomToolProvider, InternalTool, ToolContext } from '@dexto/core';

// Configuration schema for the weather tool
const WeatherToolConfigSchema = z
    .object({
        type: z.literal('weather-helper'),
        defaultCity: z.string().default('New York'),
        units: z.enum(['celsius', 'fahrenheit']).default('fahrenheit'),
    })
    .strict();

type WeatherToolConfig = z.infer<typeof WeatherToolConfigSchema>;

/**
 * Weather Tool Provider
 *
 * In a real implementation, this would call a weather API.
 * For this example, it returns mock data.
 */
export const weatherToolProvider: CustomToolProvider<'weather-helper'> = {
    type: 'weather-helper',
    configSchema: WeatherToolConfigSchema,

    create: (config: WeatherToolConfig, context: ToolContext): InternalTool[] => {
        return [
            {
                id: 'get_weather',
                description: 'Get current weather for a city',
                inputSchema: z.object({
                    city: z.string().describe('City name'),
                    units: z
                        .enum(['celsius', 'fahrenheit'])
                        .optional()
                        .describe('Temperature units'),
                }),
                execute: async (input) => {
                    const city = input.city || config.defaultCity;
                    const units = input.units || config.units;

                    // Mock weather data (in production, call a real API)
                    const temp = units === 'celsius' ? 22 : 72;
                    const conditions = 'Partly cloudy';

                    return {
                        city,
                        temperature: temp,
                        units,
                        conditions,
                        timestamp: new Date().toISOString(),
                    };
                },
            },
        ];
    },

    metadata: {
        displayName: 'Weather Helper',
        description: 'Provides weather information for cities',
        category: 'utilities',
    },
};
