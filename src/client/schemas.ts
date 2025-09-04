import { z } from 'zod';
import { DextoValidationError } from './types.js';

// ============= INPUT VALIDATION SCHEMAS =============

export const ClientConfigSchema = z
    .object({
        baseUrl: z.string().url('baseUrl must be a valid URL'),
        apiKey: z.string().optional(),
        timeout: z
            .number()
            .min(1000, 'Timeout must be at least 1000ms')
            .max(300000, 'Timeout cannot exceed 5 minutes')
            .optional(),
        retries: z
            .number()
            .min(0, 'Retries cannot be negative')
            .max(10, 'Retries cannot exceed 10')
            .optional(),
    })
    .strict();

export const ClientOptionsSchema = z
    .object({
        enableWebSocket: z.boolean().optional(),
        reconnect: z.boolean().optional(),
        reconnectInterval: z
            .number()
            .min(1000, 'Reconnect interval must be at least 1000ms')
            .max(60000, 'Reconnect interval cannot exceed 60s')
            .optional(),
        debug: z.boolean().optional(),
    })
    .strict()
    .optional();

export const MessageInputSchema = z
    .object({
        content: z
            .string()
            .min(1, 'Message content cannot be empty')
            .max(50000, 'Message content cannot exceed 50,000 characters'),
        imageData: z
            .object({
                base64: z.string().min(1, 'Image base64 data cannot be empty'),
                mimeType: z
                    .string()
                    .regex(/^image\/(jpeg|jpg|png|gif|webp|svg\+xml)$/i, 'Invalid image MIME type'),
            })
            .strict()
            .optional(),
        fileData: z
            .object({
                base64: z.string().min(1, 'File base64 data cannot be empty'),
                mimeType: z.string().min(1, 'File MIME type is required'),
                filename: z
                    .string()
                    .min(1, 'Filename cannot be empty')
                    .max(255, 'Filename too long')
                    .optional(),
            })
            .strict()
            .optional(),
        sessionId: z.string().min(1, 'Session ID cannot be empty').optional(),
        stream: z.boolean().optional(),
    })
    .strict();

export const LLMConfigInputSchema = z
    .object({
        provider: z.string().min(1, 'Provider name cannot be empty').optional(),
        model: z.string().min(1, 'Model name cannot be empty').optional(),
        router: z.enum(['vercel', 'in-built']).optional(),
        apiKey: z.string().min(1, 'API key cannot be empty').optional(),
        baseUrl: z.string().url('Base URL must be a valid URL').optional(),
        baseURL: z.string().url('Base URL must be a valid URL').optional(),
        maxTokens: z
            .number()
            .min(1, 'Max tokens must be positive')
            .max(1000000, 'Max tokens too high')
            .optional(),
        temperature: z
            .number()
            .min(0, 'Temperature cannot be negative')
            .max(2, 'Temperature cannot exceed 2')
            .optional(),
    })
    .strict()
    .refine((data) => data.provider || data.model, {
        message: 'At least provider or model must be specified',
    });

export const SearchOptionsSchema = z
    .object({
        limit: z
            .number()
            .min(1, 'Limit must be positive')
            .max(1000, 'Limit cannot exceed 1000')
            .optional(),
        offset: z.number().min(0, 'Offset cannot be negative').optional(),
        sessionId: z.string().min(1, 'Session ID cannot be empty').optional(),
        role: z.enum(['user', 'assistant', 'system', 'tool']).optional(),
    })
    .strict();

export const CatalogOptionsSchema = z
    .object({
        provider: z.string().min(1, 'Provider name cannot be empty').optional(),
        hasKey: z.boolean().optional(),
        router: z.enum(['vercel', 'in-built']).optional(),
        fileType: z.enum(['audio', 'pdf', 'image', 'text']).optional(),
        defaultOnly: z.boolean().optional(),
        mode: z.enum(['grouped', 'flat']).optional(),
    })
    .strict();

// ============= RESPONSE VALIDATION SCHEMAS =============

export const MessageResponseSchema = z
    .object({
        response: z.string(),
        sessionId: z.string(),
    })
    .strict();

export const SessionInfoSchema = z
    .object({
        id: z.string(),
        createdAt: z.number(),
        lastActivity: z.number(),
        messageCount: z.number().min(0),
    })
    .strict();

export const LLMConfigResponseSchema = z
    .object({
        provider: z.string(),
        model: z.string(),
        router: z.string().optional(),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
        baseURL: z.string().optional(),
        maxTokens: z.number().min(1).optional(),
        maxInputTokens: z.number().min(1).optional(),
        maxOutputTokens: z.number().min(1).optional(),
        maxIterations: z.number().int().positive().optional(),
        temperature: z.number().min(0).max(2).optional(),
        displayName: z.string().optional(),
    })
    .strict();

export const LLMProviderSchema = z
    .object({
        name: z.string(),
        models: z.array(z.string()),
        supportedRouters: z.array(z.string()),
        supportsBaseURL: z.boolean(),
        hasApiKey: z.boolean().optional(),
        primaryEnvVar: z.string().optional(),
    })
    .strict();

export const McpServerSchema = z
    .object({
        id: z.string(),
        name: z.string(),
        status: z.enum(['connected', 'error', 'disconnected']),
        error: z.string().optional(),
    })
    .strict();

export const ToolSchema = z
    .object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        inputSchema: z.record(z.any()).optional(),
    })
    .strict();

export const SearchResultSchema = z
    .object({
        sessionId: z.string(),
        message: z.any().optional(), // InternalMessage type from core - make optional for flexibility
        matchedText: z.string().optional(),
        context: z.string().optional(),
        messageIndex: z.number().optional(),
        // Allow additional fields for backward compatibility
        id: z.string().optional(),
        content: z.string().optional(),
        role: z.string().optional(),
        timestamp: z.number().optional(),
    })
    .strict();

export const SearchResponseSchema = z
    .object({
        results: z.array(SearchResultSchema),
        total: z.number().min(0),
        hasMore: z.boolean(),
        query: z.string().optional(),
        options: z
            .object({
                sessionId: z.string().optional(),
                role: z.enum(['user', 'assistant', 'system', 'tool']).optional(),
                limit: z.number().min(1).optional(),
                offset: z.number().min(0).optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

export const SessionSearchResponseSchema = z
    .object({
        results: z.array(
            z
                .object({
                    sessionId: z.string(),
                    matchCount: z.number().min(0),
                    firstMatch: SearchResultSchema.optional(),
                    metadata: z
                        .object({
                            createdAt: z.number(),
                            lastActivity: z.number(),
                            messageCount: z.number().min(0),
                        })
                        .strict(),
                })
                .strict()
        ),
        total: z.number().min(0),
        hasMore: z.boolean(),
        query: z.string().optional(),
        // Allow backward compatibility with old structure
        sessions: z
            .array(
                z
                    .object({
                        id: z.string(),
                        messageCount: z.number().min(0),
                        lastActivity: z.number(),
                        createdAt: z.number(),
                    })
                    .strict()
            )
            .optional(),
    })
    .strict();

export const CatalogModelSchema = z
    .object({
        name: z.string(),
        displayName: z.string().optional(),
        default: z.boolean().optional(),
        maxInputTokens: z.number().min(1),
        supportedFileTypes: z.array(z.enum(['audio', 'pdf', 'image', 'text'])),
        supportedRouters: z.array(z.enum(['vercel', 'in-built'])).optional(),
        pricing: z
            .object({
                inputPerM: z.number().min(0),
                outputPerM: z.number().min(0),
                cacheReadPerM: z.number().min(0).optional(),
                cacheWritePerM: z.number().min(0).optional(),
                currency: z.literal('USD').optional(),
                unit: z.literal('per_million_tokens').optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

export const CatalogProviderSchema = z
    .object({
        name: z.string(),
        hasApiKey: z.boolean(),
        primaryEnvVar: z.string(),
        supportedRouters: z.array(z.enum(['vercel', 'in-built'])),
        supportsBaseURL: z.boolean(),
        models: z.array(CatalogModelSchema),
        supportedFileTypes: z.array(z.enum(['audio', 'pdf', 'image', 'text'])).optional(),
    })
    .strict();

export const CatalogResponseSchema = z
    .object({
        providers: z.record(CatalogProviderSchema).optional(),
        models: z
            .array(
                CatalogModelSchema.extend({
                    provider: z.string(),
                })
            )
            .optional(),
    })
    .strict();

// ============= WRAPPED API RESPONSE SCHEMAS =============

export const SessionsListResponseSchema = z
    .object({
        sessions: z.array(SessionInfoSchema),
    })
    .strict();

export const SessionCreateResponseSchema = z
    .object({
        session: SessionInfoSchema,
    })
    .strict();

export const SessionGetResponseSchema = z
    .object({
        session: SessionInfoSchema,
    })
    .strict();

export const SessionHistoryResponseSchema = z
    .object({
        history: z.array(z.any()), // Message format varies, keep flexible
    })
    .strict();

export const CurrentSessionResponseSchema = z
    .object({
        currentSessionId: z.string(),
    })
    .strict();

export const LLMCurrentResponseSchema = z
    .object({
        config: LLMConfigResponseSchema,
    })
    .strict();

export const LLMSwitchResponseSchema = z
    .object({
        config: LLMConfigResponseSchema,
    })
    .strict();

export const LLMProvidersResponseSchema = z
    .object({
        providers: z.record(LLMProviderSchema),
    })
    .strict();

export const MCPServersResponseSchema = z
    .object({
        servers: z.array(McpServerSchema),
    })
    .strict();

export const MCPServerToolsResponseSchema = z
    .object({
        tools: z.array(ToolSchema),
    })
    .strict();

export const MCPToolExecuteResponseSchema = z
    .object({
        success: z.boolean(),
        data: z.any(),
    })
    .strict();

export const GreetingResponseSchema = z
    .object({
        greeting: z.string().nullable(),
    })
    .strict();

// ============= UTILITY FUNCTIONS =============

export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown, context: string): T {
    const result = schema.safeParse(data);
    if (!result.success) {
        throw new DextoValidationError(
            `Invalid ${context}: ${result.error.issues.map((i) => i.message).join(', ')}`,
            result.error.issues
        );
    }
    return result.data;
}

export function validateResponse<T>(schema: z.ZodSchema<T>, data: unknown, context: string): T {
    const result = schema.safeParse(data);
    if (!result.success) {
        throw new DextoValidationError(
            `Invalid response from server (${context}): ${result.error.issues.map((i) => i.message).join(', ')}`,
            result.error.issues
        );
    }
    return result.data;
}
