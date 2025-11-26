import { z } from 'zod';
import { LLM_PROVIDERS, LLM_ROUTERS } from '../llm/types.js';

// --- Content Part Schemas ---

export const TextPartSchema = z
    .object({
        type: z.literal('text'),
        text: z.string(),
    })
    .strict();

// Binary data union - supports string (base64), Uint8Array, Buffer (extends Uint8Array), ArrayBuffer, and URL
// Using z.custom for Uint8Array to accept any ArrayBufferLike backing (including SharedArrayBuffer)
const BinaryDataSchema = z.union([
    z.string(),
    z.custom<Uint8Array>((val) => val instanceof Uint8Array),
    z.custom<ArrayBuffer>((val) => val instanceof ArrayBuffer),
    z.instanceof(URL),
]);

export const ImageDataSchema = z.object({
    image: BinaryDataSchema,
    mimeType: z.string().optional(),
});

export const ImagePartSchema = ImageDataSchema.extend({
    type: z.literal('image'),
}).strict();

export const FileDataSchema = z.object({
    data: BinaryDataSchema,
    mimeType: z.string(),
    filename: z.string().optional(),
});

export const FilePartSchema = FileDataSchema.extend({
    type: z.literal('file'),
}).strict();

export const ContentPartSchema = z.discriminatedUnion('type', [
    TextPartSchema,
    ImagePartSchema,
    FilePartSchema,
]);

// --- Token Usage Schema ---

export const TokenUsageSchema = z
    .object({
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        reasoningTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional(),
    })
    .strict();

// --- Tool Call Schema ---

export const ToolCallSchema = z
    .object({
        id: z.string().describe('Unique identifier for this tool call'),
        type: z
            .literal('function')
            .describe('Tool call type (currently only function is supported)'),
        function: z
            .object({
                name: z.string().describe('Name of the function to call'),
                arguments: z.string().describe('Arguments for the function in JSON string format'),
            })
            .strict(),
    })
    .strict();

// --- Internal Message Schema ---

export const InternalMessageSchema = z
    .object({
        role: z
            .enum(['system', 'user', 'assistant', 'tool'])
            .describe('Role of the message sender'),
        timestamp: z.number().int().positive().optional().describe('Creation timestamp (Unix ms)'),
        content: z
            .union([z.string(), z.null(), z.array(ContentPartSchema)])
            .describe('Message content (string, null, or array of parts)'),
        reasoning: z.string().optional().describe('Optional model reasoning text'),
        tokenUsage: TokenUsageSchema.optional().describe('Optional token usage accounting'),
        model: z.string().optional().describe('Model identifier for assistant messages'),
        provider: z
            .enum(LLM_PROVIDERS)
            .optional()
            .describe('Provider identifier for assistant messages'),
        router: z.enum(LLM_ROUTERS).optional().describe('Router metadata for assistant messages'),
        toolCalls: z.array(ToolCallSchema).optional().describe('Tool calls made by the assistant'),
        toolCallId: z.string().optional().describe('ID of the tool call this message responds to'),
        name: z.string().optional().describe('Name of the tool that produced this result'),
    })
    .strict()
    .describe('Internal message representation');

// --- Derived Types ---

export type TextPart = z.output<typeof TextPartSchema>;
export type ImageData = z.output<typeof ImageDataSchema>;
export type ImagePart = z.output<typeof ImagePartSchema>;
export type FileData = z.output<typeof FileDataSchema>;
export type FilePart = z.output<typeof FilePartSchema>;
export type ContentPart = z.output<typeof ContentPartSchema>;
export type TokenUsage = z.output<typeof TokenUsageSchema>;
export type ToolCall = z.output<typeof ToolCallSchema>;
export type InternalMessage = z.output<typeof InternalMessageSchema>;
