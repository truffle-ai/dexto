import { z } from 'zod';
import type { SessionData } from './session-manager.js';

export const SessionTokenUsageSchema = z
    .object({
        cacheReadTokens: z.number(),
        cacheWriteTokens: z.number(),
        inputTokens: z.number(),
        outputTokens: z.number(),
        reasoningTokens: z.number(),
        totalTokens: z.number(),
    })
    .strict();

export const SessionUsageTrackingSchema = z
    .object({
        hasUntrackedChatGPTLoginUsage: z.boolean().optional(),
    })
    .strict();

export const ModelStatisticsSchema = z
    .object({
        estimatedCost: z.number(),
        firstUsedAt: z.number(),
        lastUsedAt: z.number(),
        messageCount: z.number(),
        model: z.string(),
        provider: z.string(),
        tokenUsage: SessionTokenUsageSchema,
    })
    .strict();

export const SessionDataSchema = z
    .object({
        createdAt: z.number(),
        estimatedCost: z.number().optional(),
        id: z.string(),
        lastActivity: z.number(),
        llmOverride: z.custom<NonNullable<SessionData['llmOverride']>>().optional(),
        messageCount: z.number(),
        metadata: z.record(z.unknown()).optional(),
        modelStats: z.array(ModelStatisticsSchema).optional(),
        parentSessionId: z.string().optional(),
        tokenUsage: SessionTokenUsageSchema.optional(),
        usageTracking: SessionUsageTrackingSchema.optional(),
        userId: z.string().optional(),
        workspaceId: z.string().optional(),
    })
    .strict();

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
