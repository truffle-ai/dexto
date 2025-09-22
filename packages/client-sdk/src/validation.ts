/**
 * Client SDK validation schemas for API requests
 * These are lightweight HTTP interface validations, separate from Core business logic
 */

import { z } from 'zod';

// ============= REQUEST BODY SCHEMAS =============

export const MessageRequestSchema = z
    .object({
        message: z
            .string()
            .min(1, 'Message content is required')
            .describe('Primary user message content'),
        sessionId: z
            .string()
            .describe('Optional session identifier to continue an existing conversation')
            .optional(),
        stream: z
            .boolean()
            .describe('Request a streaming response instead of a single payload')
            .optional(),
        imageData: z
            .object({
                base64: z
                    .string()
                    .min(1, 'Image data is required')
                    .describe('Base64-encoded payload for the image attachment'),
                mimeType: z
                    .string()
                    .regex(/^image\//, 'Must be a valid image MIME type')
                    .describe('MIME type describing the image payload'),
            })
            .describe('Optional image attachment to include with the message')
            .optional(),
        fileData: z
            .object({
                base64: z
                    .string()
                    .min(1, 'File data is required')
                    .describe('Base64-encoded payload for a generic file attachment'),
                mimeType: z
                    .string()
                    .min(1, 'MIME type is required')
                    .describe('MIME type describing the file attachment'),
                filename: z
                    .string()
                    .describe('Optional filename presented to the assistant')
                    .optional(),
            })
            .describe('Optional generic file attachment to include with the message')
            .optional(),
    })
    .strict()
    .describe('Request body accepted by the message REST endpoint');

export const LLMSwitchRequestSchema = z
    .object({
        provider: z.string().describe('LLM provider to target').optional(),
        model: z.string().describe('Model identifier provided by the selected provider').optional(),
        router: z
            .enum(['vercel', 'in-built'])
            .describe('Routing layer to use for the model')
            .optional(),
        baseURL: z
            .string()
            .url()
            .describe('Optional custom API base URL for compatible providers')
            .optional(),
        apiKey: z
            .string()
            .describe('API key to use when switching to a different provider')
            .optional(),
        temperature: z
            .number()
            .min(0)
            .max(2)
            .describe('Sampling temperature controlling response creativity (0-2)')
            .optional(),
        maxTokens: z
            .number()
            .min(1)
            .describe('Maximum number of tokens to allow for the response')
            .optional(),
        sessionId: z
            .string()
            .describe('Optional session identifier to scope the LLM switch')
            .optional(),
    })
    .strict()
    .describe('Payload for switching the active LLM configuration');

export const SessionCreateRequestSchema = z
    .object({
        sessionId: z
            .string()
            .describe('Optional custom identifier to assign to the created session')
            .optional(),
    })
    .strict()
    .describe('Request payload for creating a new chat session');

export const ResetRequestSchema = z
    .object({
        sessionId: z
            .string()
            .describe('Optional session identifier to reset; omit to reset the active session')
            .optional(),
    })
    .strict()
    .describe('Request body for resetting a conversation session');

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
    .strict()
    .describe('Request body for registering a new MCP server');

// ============= QUERY PARAMETER SCHEMAS =============

export const CatalogQuerySchema = z
    .object({
        provider: z.string().describe('Filter catalog entries by provider name').optional(),
        hasKey: z
            .enum(['true', 'false'])
            .describe('Limit results based on whether an API key is configured')
            .optional(),
        router: z
            .enum(['vercel', 'in-built'])
            .describe('Restrict results to a router type')
            .optional(),
        fileType: z
            .enum(['audio', 'pdf', 'image'])
            .describe('Return models that support the specified file type')
            .optional(),
        defaultOnly: z
            .enum(['true', 'false'])
            .describe('When true, include only provider default models')
            .optional(),
        mode: z
            .enum(['grouped', 'flat'])
            .describe('Formatting of the response payload (grouped by provider or flat list)')
            .optional(),
    })
    .strict()
    .describe('Query parameters for the LLM catalog endpoint');

export const SearchMessagesQuerySchema = z
    .object({
        q: z.string().min(1, 'Query is required').describe('Search query string'),
        limit: z
            .string()
            .regex(/^\d+$/, 'Limit must be a number')
            .describe('Maximum number of results to return')
            .optional(),
        offset: z
            .string()
            .regex(/^\d+$/, 'Offset must be a number')
            .describe('Number of results to skip for pagination')
            .optional(),
        sessionId: z
            .string()
            .describe('Optional session identifier to scope the search')
            .optional(),
        role: z
            .enum(['user', 'assistant', 'system', 'tool'])
            .describe('Filter results by message role')
            .optional(),
    })
    .strict()
    .describe('Query parameters for message search requests');

export const SearchSessionsQuerySchema = z
    .object({
        q: z
            .string()
            .min(1, 'Query is required')
            .describe('Search query string used to match sessions'),
    })
    .strict()
    .describe('Query parameters for locating sessions by text');

export const GreetingQuerySchema = z
    .object({
        sessionId: z
            .string()
            .describe('Optional session identifier used to personalize the greeting')
            .optional(),
    })
    .strict()
    .describe('Query parameters accepted by the greeting endpoint');

export const SessionIdQuerySchema = z
    .object({
        sessionId: z.string().describe('Required session identifier'),
    })
    .strict()
    .describe('Generic schema for routes that require a session identifier');

// Re-export Zod for convenience
export { z } from 'zod';

// Type exports for convenience
export type CatalogQuery = z.infer<typeof CatalogQuerySchema>;
export type MessageRequest = z.infer<typeof MessageRequestSchema>;
export type LLMSwitchRequest = z.infer<typeof LLMSwitchRequestSchema>;
export type SessionCreateRequest = z.infer<typeof SessionCreateRequestSchema>;
export type ResetRequest = z.infer<typeof ResetRequestSchema>;
export type McpServerRequest = z.infer<typeof McpServerRequestSchema>;
export type SearchMessagesQuery = z.infer<typeof SearchMessagesQuerySchema>;
export type SearchSessionsQuery = z.infer<typeof SearchSessionsQuerySchema>;
export type GreetingQuery = z.infer<typeof GreetingQuerySchema>;
export type SessionIdQuery = z.infer<typeof SessionIdQuerySchema>;
