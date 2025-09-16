import { z } from 'zod';
import { ClientError } from './errors.js';
import { zodToIssues } from '@dexto/core';

// ============= INPUT VALIDATION SCHEMAS =============

export const ClientConfigSchema = z
    .object({
        baseUrl: z
            .string()
            .url('baseUrl must be a valid URL')
            .refine((u) => /^https?:\/\//i.test(u), 'baseUrl must start with http or https')
            .describe('Base URL for the API endpoint'),
        apiKey: z.string().optional().describe('API key for authentication'),
        timeout: z
            .number()
            .min(1000, 'Timeout must be at least 1000ms')
            .max(300000, 'Timeout cannot exceed 5 minutes')
            .default(30000)
            .describe('Request timeout in milliseconds'),
        retries: z
            .number()
            .min(0, 'Retries cannot be negative')
            .max(10, 'Retries cannot exceed 10')
            .default(3)
            .describe('Number of retry attempts for failed requests'),
    })
    .strict();

export const ClientOptionsSchema = z
    .object({
        enableWebSocket: z
            .boolean()
            .default(true)
            .describe('Enable WebSocket connection for real-time updates'),
        reconnect: z.boolean().default(true).describe('Automatically reconnect on connection loss'),
        reconnectInterval: z
            .number()
            .min(1000, 'Reconnect interval must be at least 1000ms')
            .max(60000, 'Reconnect interval cannot exceed 60s')
            .default(5000)
            .describe('Time between reconnection attempts in milliseconds'),
        debug: z.boolean().default(false).describe('Enable debug logging'),
    })
    .strict()
    .default({})
    .describe('Optional client configuration options');

export const MessageInputSchema = z
    .object({
        content: z
            .string()
            .min(1, 'Message content cannot be empty')
            .max(50000, 'Message content cannot exceed 50,000 characters')
            .describe('The text content of the message'),
        imageData: z
            .object({
                base64: z
                    .string()
                    .min(1, 'Image base64 data cannot be empty')
                    .describe('Base64 encoded image data'),
                mimeType: z
                    .string()
                    .regex(/^image\/(jpeg|jpg|png|gif|webp|svg\+xml)$/i, 'Invalid image MIME type')
                    .describe('MIME type of the image'),
            })
            .strict()
            .optional()
            .describe('Optional image attachment'),
        fileData: z
            .object({
                base64: z
                    .string()
                    .min(1, 'File base64 data cannot be empty')
                    .describe('Base64 encoded file data'),
                mimeType: z
                    .string()
                    .min(1, 'File MIME type is required')
                    .describe('MIME type of the file'),
                filename: z
                    .string()
                    .min(1, 'Filename cannot be empty')
                    .max(255, 'Filename too long')
                    .optional()
                    .describe('Original filename'),
            })
            .strict()
            .optional()
            .describe('Optional file attachment'),
        sessionId: z
            .string()
            .min(1, 'Session ID cannot be empty')
            .optional()
            .describe('Session ID to send message to'),
        stream: z.boolean().optional().describe('Enable streaming response'),
    })
    .strict();

export const LLMConfigInputSchema = z
    .object({
        provider: z
            .string()
            .min(1, 'Provider name cannot be empty')
            .optional()
            .describe('LLM provider name'),
        model: z
            .string()
            .min(1, 'Model name cannot be empty')
            .optional()
            .describe('Model identifier'),
        router: z
            .enum(['vercel', 'in-built'])
            .optional()
            .describe('Routing strategy for LLM requests'),
        apiKey: z
            .string()
            .min(1, 'API key cannot be empty')
            .optional()
            .describe('API key for the provider'),
        baseUrl: z
            .string()
            .url('Base URL must be a valid URL')
            .optional()
            .describe('Custom base URL for the provider'),
        maxTokens: z
            .number()
            .min(1, 'Max tokens must be positive')
            .max(1000000, 'Max tokens too high')
            .optional()
            .describe('Maximum number of tokens to generate'),
        temperature: z
            .number()
            .min(0, 'Temperature cannot be negative')
            .max(2, 'Temperature cannot exceed 2')
            .optional()
            .describe('Temperature for response generation'),
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
            .optional()
            .describe('Maximum number of results to return'),
        offset: z
            .number()
            .min(0, 'Offset cannot be negative')
            .optional()
            .describe('Number of results to skip'),
        sessionId: z
            .string()
            .min(1, 'Session ID cannot be empty')
            .optional()
            .describe('Filter by session ID'),
        role: z
            .enum(['user', 'assistant', 'system', 'tool'])
            .optional()
            .describe('Filter by message role'),
    })
    .strict();

export const CatalogOptionsSchema = z
    .object({
        provider: z
            .string()
            .min(1, 'Provider name cannot be empty')
            .optional()
            .describe('Filter by provider name'),
        hasKey: z.boolean().optional().describe('Filter by API key availability'),
        router: z.enum(['vercel', 'in-built']).optional().describe('Filter by supported router'),
        fileType: z
            .enum(['audio', 'pdf', 'image', 'text'])
            .optional()
            .describe('Filter by supported file type'),
        defaultOnly: z.boolean().optional().describe('Return only default models'),
        mode: z.enum(['grouped', 'flat']).optional().describe('Response format mode'),
    })
    .strict();

// ============= DOMAIN TYPE SCHEMAS (used for input validation) =============

export const McpServerSchema = z
    .object({
        id: z.string(),
        name: z.string(),
        status: z.enum(['connected', 'disconnected', 'error', 'unknown']),
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

// ============= UTILITY FUNCTIONS =============

export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) {
        throw ClientError.validationFailed(zodToIssues(result.error));
    }
    return result.data;
}
