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
        metadata: z.record(z.string(), z.unknown()).optional(),
        modelStats: z.array(ModelStatisticsSchema).optional(),
        parentSessionId: z.string().optional(),
        tokenUsage: SessionTokenUsageSchema.optional(),
        usageTracking: SessionUsageTrackingSchema.optional(),
        userId: z.string().optional(),
        workspaceId: z.string().optional(),
    })
    .strict();

function normalizeUsageTracking(
    value: z.output<typeof SessionUsageTrackingSchema> | undefined
): SessionData['usageTracking'] {
    if (value === undefined) {
        return undefined;
    }

    return {
        ...(value.hasUntrackedChatGPTLoginUsage === undefined
            ? {}
            : { hasUntrackedChatGPTLoginUsage: value.hasUntrackedChatGPTLoginUsage }),
    };
}

export function parseSessionData(value: unknown): SessionData {
    const parsed = SessionDataSchema.parse(value);
    const usageTracking = normalizeUsageTracking(parsed.usageTracking);

    return {
        createdAt: parsed.createdAt,
        id: parsed.id,
        lastActivity: parsed.lastActivity,
        messageCount: parsed.messageCount,
        ...(parsed.estimatedCost === undefined ? {} : { estimatedCost: parsed.estimatedCost }),
        ...(parsed.llmOverride === undefined ? {} : { llmOverride: parsed.llmOverride }),
        ...(parsed.metadata === undefined ? {} : { metadata: parsed.metadata }),
        ...(parsed.modelStats === undefined ? {} : { modelStats: parsed.modelStats }),
        ...(parsed.parentSessionId === undefined
            ? {}
            : { parentSessionId: parsed.parentSessionId }),
        ...(parsed.tokenUsage === undefined ? {} : { tokenUsage: parsed.tokenUsage }),
        ...(usageTracking === undefined ? {} : { usageTracking }),
        ...(parsed.userId === undefined ? {} : { userId: parsed.userId }),
        ...(parsed.workspaceId === undefined ? {} : { workspaceId: parsed.workspaceId }),
    };
}

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
