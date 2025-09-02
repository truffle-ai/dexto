import { z } from 'zod';

export const SessionConfigSchema = z
    .object({
        maxSessions: z
            .number()
            .int()
            .positive()
            .default(100)
            .describe('Maximum number of concurrent sessions allowed, defaults to 100'),
        sessionTTL: z
            .number()
            .int()
            .positive()
            .default(3600000)
            .describe('Session time-to-live in milliseconds, defaults to 3600000ms (1 hour)'),
    })
    .strict()
    .describe('Session management configuration');

export type SessionConfig = z.input<typeof SessionConfigSchema>;
export type ValidatedSessionConfig = z.output<typeof SessionConfigSchema>;
