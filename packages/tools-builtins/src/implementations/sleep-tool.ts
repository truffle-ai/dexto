import { z } from 'zod';
import type { Tool, ToolExecutionContext } from '@dexto/core';

const SleepInputSchema = z
    .object({
        ms: z
            .number()
            .int()
            .positive()
            .max(600000)
            .describe('Milliseconds to sleep (max 10 minutes)'),
    })
    .strict();

type SleepInput = z.output<typeof SleepInputSchema>;

/**
 * Internal tool for sleeping/delaying execution.
 */
export function createSleepTool(): Tool {
    return {
        id: 'sleep',
        description: 'Pause execution for a specified number of milliseconds.',
        inputSchema: SleepInputSchema,
        execute: async (input: unknown, _context: ToolExecutionContext) => {
            const { ms } = input as SleepInput;
            await new Promise((resolve) => setTimeout(resolve, ms));
            return { sleptMs: ms };
        },
    };
}
