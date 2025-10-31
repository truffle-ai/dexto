/**
 * Response schemas for OpenAPI documentation
 *
 * This file defines Zod schemas for all API response types, following these principles:
 * 1. Import reusable schemas from @dexto/core to avoid duplication
 * 2. Define new schemas for types that only exist as TypeScript interfaces
 * 3. All schemas follow Zod best practices from CLAUDE.md (strict, describe, etc.)
 */

import { z } from 'zod';

// ============================================================================
// Imports from @dexto/core - Reusable schemas
// ============================================================================

// Memory schemas
export { MemorySchema } from '@dexto/core';

// LLM schemas
export { LLMConfigSchema, type ValidatedLLMConfig } from '@dexto/core';

// Agent schemas
export { AgentCardSchema, type AgentCard } from '@dexto/core';

// MCP schemas
export {
    McpServerConfigSchema,
    StdioServerConfigSchema,
    SseServerConfigSchema,
    HttpServerConfigSchema,
    type McpServerConfig,
    type ValidatedMcpServerConfig,
} from '@dexto/core';

// Tool schemas
export { ToolConfirmationConfigSchema } from '@dexto/core';

// Resource schemas
export { InternalResourceConfigSchema } from '@dexto/core';

// ============================================================================
// New schemas for types that don't have Zod equivalents in core
// ============================================================================

// --- Session Schemas ---

export const SessionMetadataSchema = z
    .object({
        id: z.string().describe('Unique session identifier'),
        createdAt: z.number().int().positive().describe('Creation timestamp (Unix ms)'),
        lastActivity: z.number().int().positive().describe('Last activity timestamp (Unix ms)'),
        messageCount: z
            .number()
            .int()
            .nonnegative()
            .describe('Total number of messages in session'),
        title: z.string().optional().nullable().describe('Optional session title'),
    })
    .strict()
    .describe('Session metadata');

export type SessionMetadata = z.output<typeof SessionMetadataSchema>;

// --- Message Schemas ---

const TextPartSchema = z
    .object({
        type: z.literal('text').describe('Part type: text'),
        text: z.string().describe('Text content'),
    })
    .strict()
    .describe('Text content part');

const ImagePartSchema = z
    .object({
        type: z.literal('image').describe('Part type: image'),
        image: z
            .union([z.string(), z.instanceof(Uint8Array), z.instanceof(Buffer), z.instanceof(URL)])
            .describe('Image data (string, binary, or URL)'),
        mimeType: z.string().optional().describe('MIME type of the image'),
    })
    .strict()
    .describe('Image content part');

const FilePartSchema = z
    .object({
        type: z.literal('file').describe('Part type: file'),
        data: z
            .union([z.string(), z.instanceof(Uint8Array), z.instanceof(Buffer), z.instanceof(URL)])
            .describe('File data (string, binary, or URL)'),
        mimeType: z.string().describe('MIME type of the file'),
        filename: z.string().optional().describe('Optional filename'),
    })
    .strict()
    .describe('File content part');

const ContentPartSchema = z
    .discriminatedUnion('type', [TextPartSchema, ImagePartSchema, FilePartSchema])
    .describe('Message content part (text, image, or file)');

const ToolCallSchema = z
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
            .strict()
            .describe('Function call details'),
    })
    .strict()
    .describe('Tool call made by the assistant');

const TokenUsageSchema = z
    .object({
        inputTokens: z.number().int().nonnegative().optional().describe('Number of input tokens'),
        outputTokens: z.number().int().nonnegative().optional().describe('Number of output tokens'),
        reasoningTokens: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe('Number of reasoning tokens'),
        totalTokens: z.number().int().nonnegative().optional().describe('Total tokens used'),
    })
    .strict()
    .describe('Token usage accounting');

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
        provider: z.string().optional().describe('Provider identifier for assistant messages'),
        router: z.string().optional().describe('Router metadata for assistant messages'),
        toolCalls: z.array(ToolCallSchema).optional().describe('Tool calls made by the assistant'),
        toolCallId: z.string().optional().describe('ID of the tool call this message responds to'),
        name: z.string().optional().describe('Name of the tool that produced this result'),
    })
    .strict()
    .describe('Internal message representation');

export type InternalMessage = z.output<typeof InternalMessageSchema>;

// --- Search Schemas ---

export const SearchResultSchema = z
    .object({
        sessionId: z.string().describe('Session ID where the message was found'),
        message: InternalMessageSchema.describe('The message that matched the search'),
        matchedText: z.string().describe('The specific text that matched the search query'),
        context: z.string().describe('Context around the match for preview'),
        messageIndex: z
            .number()
            .int()
            .nonnegative()
            .describe('Index of the message within the session'),
    })
    .strict()
    .describe('Result of a message search');

export type SearchResult = z.output<typeof SearchResultSchema>;

export const SessionSearchResultSchema = z
    .object({
        sessionId: z.string().describe('Session ID'),
        matchCount: z
            .number()
            .int()
            .nonnegative()
            .describe('Number of messages that matched in this session'),
        firstMatch: SearchResultSchema.describe('Preview of the first matching message'),
        metadata: z
            .object({
                createdAt: z.number().int().positive().describe('Session creation timestamp'),
                lastActivity: z.number().int().positive().describe('Last activity timestamp'),
                messageCount: z.number().int().nonnegative().describe('Total messages in session'),
            })
            .strict()
            .describe('Session metadata'),
    })
    .strict()
    .describe('Result of a session search');

export type SessionSearchResult = z.output<typeof SessionSearchResultSchema>;

// --- Webhook Schemas ---

export const WebhookSchema = z
    .object({
        id: z.string().describe('Unique webhook identifier'),
        url: z.string().url().describe('Webhook URL to send events to'),
        events: z.array(z.string()).describe('Array of event types this webhook subscribes to'),
        createdAt: z.number().int().positive().describe('Creation timestamp (Unix ms)'),
    })
    .strict()
    .describe('Webhook subscription');

export type Webhook = z.output<typeof WebhookSchema>;

// --- LLM Provider/Model Schemas ---

export const ModelInfoSchema = z
    .object({
        id: z.string().describe('Model identifier'),
        name: z.string().describe('Human-readable model name'),
        provider: z.string().describe('Provider name'),
        maxInputTokens: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Maximum input tokens supported'),
        maxOutputTokens: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Maximum output tokens supported'),
        supportsStreaming: z.boolean().optional().describe('Whether streaming is supported'),
        supportsVision: z.boolean().optional().describe('Whether vision/images are supported'),
        supportsToolCalling: z.boolean().optional().describe('Whether tool calling is supported'),
    })
    .strict()
    .describe('Information about an LLM model');

export type ModelInfo = z.output<typeof ModelInfoSchema>;

export const ProviderInfoSchema = z
    .object({
        id: z.string().describe('Provider identifier'),
        name: z.string().describe('Human-readable provider name'),
        models: z.array(z.string()).describe('List of supported model IDs'),
        requiresApiKey: z.boolean().describe('Whether this provider requires an API key'),
        supportsBaseURL: z.boolean().describe('Whether this provider supports custom base URLs'),
    })
    .strict()
    .describe('Information about an LLM provider');

export type ProviderInfo = z.output<typeof ProviderInfoSchema>;

// --- Agent Registry Schemas ---

export const AgentRegistryEntrySchema = z
    .object({
        id: z.string().describe('Unique agent identifier'),
        name: z.string().describe('Agent name'),
        description: z.string().optional().describe('Agent description'),
        path: z.string().describe('Path to agent configuration file'),
        isActive: z.boolean().describe('Whether this is the currently active agent'),
    })
    .strict()
    .describe('Agent registry entry');

export type AgentRegistryEntry = z.output<typeof AgentRegistryEntrySchema>;

// --- Resource Schemas ---

export const ResourceSchema = z
    .object({
        uri: z.string().describe('Resource URI'),
        name: z.string().describe('Resource name'),
        description: z.string().optional().describe('Resource description'),
        mimeType: z.string().optional().describe('MIME type of the resource'),
    })
    .strict()
    .describe('Resource metadata');

export type Resource = z.output<typeof ResourceSchema>;

// --- Tool Schemas ---

export const ToolSchema = z
    .object({
        name: z.string().describe('Tool name'),
        description: z.string().describe('Tool description'),
        inputSchema: z.record(z.any()).describe('JSON Schema for tool input parameters'),
    })
    .strict()
    .describe('Tool metadata');

export type Tool = z.output<typeof ToolSchema>;

// --- Prompt Schemas ---

export const PromptSchema = z
    .object({
        id: z.string().describe('Unique prompt identifier'),
        name: z.string().describe('Prompt name'),
        description: z.string().optional().describe('Prompt description'),
        content: z.string().describe('Prompt template content'),
        variables: z
            .array(z.string())
            .optional()
            .describe('List of variable placeholders in the prompt'),
    })
    .strict()
    .describe('Prompt template');

export type Prompt = z.output<typeof PromptSchema>;

// ============================================================================
// Common Response Patterns
// ============================================================================

// Generic success response with data
export const OkResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
    z
        .object({
            ok: z.literal(true).describe('Indicates successful response'),
            data: dataSchema.describe('Response data'),
        })
        .strict()
        .describe('Successful API response');

// Generic error response
export const ErrorResponseSchema = z
    .object({
        ok: z.literal(false).describe('Indicates failed response'),
        error: z
            .object({
                message: z.string().describe('Error message'),
                code: z.string().optional().describe('Error code'),
                details: z.any().optional().describe('Additional error details'),
            })
            .strict()
            .describe('Error details'),
    })
    .strict()
    .describe('Error API response');

export type ErrorResponse = z.output<typeof ErrorResponseSchema>;

// Status response (for operations that don't return data)
export const StatusResponseSchema = z
    .object({
        status: z.string().describe('Operation status'),
        message: z.string().optional().describe('Optional status message'),
    })
    .strict()
    .describe('Status response');

export type StatusResponse = z.output<typeof StatusResponseSchema>;

// Delete response
export const DeleteResponseSchema = z
    .object({
        status: z.literal('deleted').describe('Indicates successful deletion'),
        id: z.string().optional().describe('ID of the deleted resource'),
    })
    .strict()
    .describe('Delete operation response');

export type DeleteResponse = z.output<typeof DeleteResponseSchema>;
