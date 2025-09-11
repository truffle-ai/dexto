/**
 * Independent WebUI API validation schemas using Zod
 * NO @core imports for deployment separation
 */

import { z } from 'zod';

// ============= QUERY PARAMETER SCHEMAS =============

export const CatalogQuerySchema = z
    .object({
        provider: z.string().optional(),
        hasKey: z.enum(['true', 'false']).optional(),
        router: z.enum(['vercel', 'in-built']).optional(),
        fileType: z.enum(['audio', 'pdf', 'image', 'text']).optional(),
        defaultOnly: z.enum(['true', 'false']).optional(),
        mode: z.enum(['grouped', 'flat']).optional(),
    })
    .strict();

export const GreetingQuerySchema = z
    .object({
        sessionId: z.string().optional(),
    })
    .strict();

export const SessionIdQuerySchema = z
    .object({
        sessionId: z.string(),
    })
    .strict();

// ============= REQUEST BODY SCHEMAS =============

export const MessageRequestSchema = z
    .object({
        message: z.string().min(1, 'Message content is required'),
        sessionId: z.string().optional(),
        stream: z.boolean().optional(),
        imageData: z
            .object({
                base64: z.string().min(1, 'Image data is required'),
                mimeType: z.string().regex(/^image\//, 'Must be a valid image MIME type'),
            })
            .optional(),
        fileData: z
            .object({
                base64: z.string().min(1, 'File data is required'),
                mimeType: z.string().min(1, 'MIME type is required'),
                filename: z.string().optional(),
            })
            .optional(),
    })
    .strict();

export const LLMSwitchRequestSchema = z
    .object({
        provider: z.string().optional(),
        model: z.string().optional(),
        router: z.enum(['vercel', 'in-built']).optional(),
        baseURL: z.string().url().optional(),
        apiKey: z.string().optional(),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().min(1).optional(),
        sessionId: z.string().optional(),
    })
    .strict();

export const ResetRequestSchema = z
    .object({
        sessionId: z.string().optional(),
    })
    .strict();

export const McpServerRequestSchema = z
    .object({
        name: z.string().min(1, 'Server name is required'),
        config: z
            .object({
                type: z.enum(['stdio', 'sse', 'http']),
                command: z.string().optional(),
                args: z.array(z.string()).optional(),
                url: z.string().url().optional(),
                env: z.record(z.string()).optional(),
            })
            .strict()
            .superRefine((cfg, ctx) => {
                if (cfg.type === 'stdio') {
                    if (!cfg.command) {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            message: 'command is required for stdio',
                            path: ['command'],
                        });
                    }
                } else if (cfg.type === 'sse' || cfg.type === 'http') {
                    if (!cfg.url) {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            message: 'url is required for sse/http',
                            path: ['url'],
                        });
                    }
                }
            }),
    })
    .strict();

export const SessionCreateRequestSchema = z
    .object({
        sessionId: z.string().optional(),
    })
    .strict();

export const SearchMessagesQuerySchema = z
    .object({
        q: z.string().min(1, 'Query is required'),
        limit: z.string().regex(/^\d+$/, 'Limit must be a number').optional(),
        offset: z.string().regex(/^\d+$/, 'Offset must be a number').optional(),
        sessionId: z.string().optional(),
        role: z.enum(['user', 'assistant', 'system', 'tool']).optional(),
    })
    .strict();

export const SearchSessionsQuerySchema = z
    .object({
        q: z.string().min(1, 'Query is required'),
    })
    .strict();

// ============= RESPONSE SCHEMAS =============

export const ApiSuccessResponseSchema = z
    .object({
        ok: z.literal(true),
        data: z.unknown().optional(),
    })
    .strict();

export const ApiErrorResponseSchema = z
    .object({
        ok: z.literal(false).optional(),
        error: z.string(),
        code: z.string().optional(),
        details: z.unknown().optional(),
    })
    .strict();

export const GreetingResponseSchema = z
    .object({
        greeting: z.string().nullable(),
    })
    .strict();

// ============= VALIDATION HELPERS =============

export interface ValidationSuccess<T> {
    success: true;
    data: T;
}

export interface ValidationError {
    success: false;
    error: string;
    details?: z.ZodError;
    response: { error: string; code?: string };
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationError;

/**
 * Validate request body with Zod schema
 */
export function validateBody<T>(schema: z.ZodSchema<T>, body: unknown): ValidationResult<T> {
    try {
        const data = schema.parse(body);
        return { success: true, data };
    } catch (error) {
        if (error instanceof z.ZodError) {
            const message = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
            return {
                success: false,
                error: `Validation failed: ${message}`,
                details: error,
                response: { error: `Invalid request body: ${message}`, code: 'VALIDATION_ERROR' },
            };
        }
        return {
            success: false,
            error: 'Validation failed',
            response: { error: 'Invalid request body' },
        };
    }
}

/**
 * Validate query parameters with Zod schema
 */
export function validateQuery<T>(schema: z.ZodSchema<T>, query: unknown): ValidationResult<T> {
    try {
        const data = schema.parse(query);
        return { success: true, data };
    } catch (error) {
        if (error instanceof z.ZodError) {
            const message = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
            return {
                success: false,
                error: `Query validation failed: ${message}`,
                details: error,
                response: {
                    error: `Invalid query parameters: ${message}`,
                    code: 'VALIDATION_ERROR',
                },
            };
        }
        return {
            success: false,
            error: 'Query validation failed',
            response: { error: 'Invalid query parameters' },
        };
    }
}
