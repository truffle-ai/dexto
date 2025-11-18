/**
 * Response schemas for OpenAPI documentation
 *
 * This file defines Zod schemas for all API response types, following these principles:
 * 1. Import reusable schemas from @dexto/core to avoid duplication
 * 2. Define new schemas for types that only exist as TypeScript interfaces
 * 3. All schemas follow Zod best practices from CLAUDE.md (strict, describe, etc.)
 */

import { z } from 'zod';
import { LLMConfigBaseSchema as CoreLLMConfigBaseSchema } from '@dexto/core';

// ============================================================================
// Imports from @dexto/core - Reusable schemas
// ============================================================================

// Memory schemas
export { MemorySchema } from '@dexto/core';

// LLM schemas
export { LLMConfigBaseSchema, type ValidatedLLMConfig } from '@dexto/core';

// LLM config response schema - omits apiKey for security
// API keys should never be returned in responses
export const LLMConfigResponseSchema = CoreLLMConfigBaseSchema.omit({ apiKey: true })
    .extend({
        hasApiKey: z.boolean().optional().describe('Whether an API key is configured'),
    })
    .describe('LLM configuration (apiKey omitted for security)');

// Full LLM config schema for requests (includes apiKey with writeOnly)
export const LLMConfigSchema = CoreLLMConfigBaseSchema.describe('LLM configuration with API key');

export type LLMConfigResponse = z.output<typeof LLMConfigResponseSchema>;

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

// --- Binary Data Schema ---

/**
 * Schema for binary data that can be string, Buffer, Uint8Array, or URL.
 * Uses z.custom<string | unknown>() to avoid DTS complexity - TypeScript consumers see
 * 'string | unknown' (where unknown represents binary data), while runtime validation
 * still properly validates all supported types.
 *
 * Note: Even Uint8Array alone causes DTS generation failures due to structural type expansion,
 * so we must use 'unknown' for binary types to keep .d.ts files manageable.
 *
 * TODO: Investigate alternatives for better type information in .d.ts files:
 *       - Custom type bundling/declaration generation
 *       - Runtime-only validation with separate type definitions
 *       - tsup configuration adjustments to handle structural types
 */
const BinaryDataSchema = z.custom<string | unknown>(
    (val) => {
        return (
            typeof val === 'string' ||
            val instanceof Buffer ||
            val instanceof Uint8Array ||
            val instanceof URL
        );
    },
    { message: 'Must be string, Buffer, Uint8Array, or URL' }
);

// --- Session Schemas ---

export const SubAgentMetadataSchema = z
    .object({
        parentSessionId: z.string().describe('Parent session ID'),
        depth: z.number().int().positive().describe('Depth in session hierarchy (1+)'),
        lifecycle: z.enum(['ephemeral', 'persistent']).describe('Lifecycle policy for the session'),
        agentIdentifier: z
            .string()
            .optional()
            .describe('Agent identifier (e.g., built-in:code-reviewer)'),
    })
    .strict()
    .describe('Sub-agent specific metadata');

export type SubAgentMetadata = z.output<typeof SubAgentMetadataSchema>;

export const SessionMetadataSchema = z
    .object({
        id: z.string().describe('Unique session identifier'),
        createdAt: z
            .number()
            .int()
            .positive()
            .nullable()
            .describe('Creation timestamp (Unix ms, null if unavailable)'),
        lastActivity: z
            .number()
            .int()
            .positive()
            .nullable()
            .describe('Last activity timestamp (Unix ms, null if unavailable)'),
        messageCount: z
            .number()
            .int()
            .nonnegative()
            .describe('Total number of messages in session'),
        title: z.string().optional().nullable().describe('Optional session title'),
        type: z.string().describe('Session type (primary, sub-agent, scheduled, task, or custom)'),
        metadata: z
            .record(z.unknown())
            .optional()
            .describe('Type-specific flexible metadata (e.g., subAgent for sub-agent sessions)'),
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
        image: BinaryDataSchema.describe('Image data (string, binary, or URL)'),
        mimeType: z.string().optional().describe('MIME type of the image'),
    })
    .strict()
    .describe('Image content part');

const FilePartSchema = z
    .object({
        type: z.literal('file').describe('Part type: file'),
        data: BinaryDataSchema.describe('File data (string, binary, or URL)'),
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

// Schema for ModelInfo from core registry
export const CatalogModelInfoSchema = z
    .object({
        name: z.string().describe('Model name identifier'),
        maxInputTokens: z.number().int().positive().describe('Maximum input tokens'),
        default: z.boolean().optional().describe('Whether this is a default model'),
        supportedFileTypes: z
            .array(z.enum(['audio', 'pdf', 'image']))
            .describe('File types this model supports'),
        supportedRouters: z
            .array(z.enum(['vercel', 'in-built']))
            .optional()
            .describe('Routing strategies this model supports'),
        displayName: z.string().optional().describe('Human-readable display name'),
        pricing: z
            .object({
                inputPerM: z.number().describe('Input cost per million tokens (USD)'),
                outputPerM: z.number().describe('Output cost per million tokens (USD)'),
                cacheReadPerM: z.number().optional().describe('Cache read cost per million tokens'),
                cacheWritePerM: z
                    .number()
                    .optional()
                    .describe('Cache write cost per million tokens'),
                currency: z.literal('USD').optional().describe('Currency'),
                unit: z.literal('per_million_tokens').optional().describe('Unit'),
            })
            .optional()
            .describe('Pricing information in USD per million tokens'),
    })
    .strict()
    .describe('Model information from LLM registry');

export type CatalogModelInfo = z.output<typeof CatalogModelInfoSchema>;

// Schema for ProviderCatalog returned by /llm/catalog (grouped mode)
export const ProviderCatalogSchema = z
    .object({
        name: z.string().describe('Provider display name'),
        hasApiKey: z.boolean().describe('Whether API key is configured'),
        primaryEnvVar: z.string().describe('Primary environment variable for API key'),
        supportedRouters: z
            .array(z.enum(['vercel', 'in-built']))
            .describe('Routing strategies supported by this provider'),
        supportsBaseURL: z.boolean().describe('Whether custom base URLs are supported'),
        models: z.array(CatalogModelInfoSchema).describe('Models available from this provider'),
        supportedFileTypes: z
            .array(z.enum(['audio', 'pdf', 'image']))
            .describe('Provider-level file type support'),
    })
    .strict()
    .describe('Provider catalog entry with models and capabilities');

export type ProviderCatalog = z.output<typeof ProviderCatalogSchema>;

// Schema for flat model list (includes provider field)
export const ModelFlatSchema = CatalogModelInfoSchema.extend({
    provider: z.string().describe('Provider identifier for this model'),
}).describe('Flattened model entry with provider information');

export type ModelFlat = z.output<typeof ModelFlatSchema>;

// --- Agent Registry Schemas ---

export const AgentRegistryEntrySchema = z
    .object({
        id: z.string().describe('Unique agent identifier'),
        name: z.string().describe('Agent name'),
        description: z.string().describe('Agent description'),
        author: z.string().optional().describe('Agent author'),
        tags: z.array(z.string()).optional().describe('Agent tags'),
        type: z.enum(['builtin', 'custom']).describe('Agent type'),
    })
    .strict()
    .describe('Agent registry entry');

export type AgentRegistryEntry = z.output<typeof AgentRegistryEntrySchema>;

// --- Resource Schemas ---

export const ResourceSchema = z
    .object({
        uri: z.string().describe('Resource URI'),
        name: z.string().optional().describe('Resource name'),
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
        inputSchema: z.record(z.unknown()).describe('JSON Schema for tool input parameters'),
    })
    .strict()
    .describe('Tool metadata');

export type Tool = z.output<typeof ToolSchema>;

// --- Prompt Schemas ---

export const PromptArgumentSchema = z
    .object({
        name: z.string().describe('Argument name'),
        description: z.string().optional().describe('Argument description'),
        required: z.boolean().optional().describe('Whether the argument is required'),
    })
    .strict()
    .describe('Prompt argument definition');

export type PromptArgument = z.output<typeof PromptArgumentSchema>;

export const PromptDefinitionSchema = z
    .object({
        name: z.string().describe('Prompt name'),
        title: z.string().optional().describe('Prompt title'),
        description: z.string().optional().describe('Prompt description'),
        arguments: z
            .array(PromptArgumentSchema)
            .optional()
            .describe('Array of argument definitions'),
    })
    .strict()
    .describe('Prompt definition (MCP-compliant)');

export type PromptDefinition = z.output<typeof PromptDefinitionSchema>;

export const PromptInfoSchema = z
    .object({
        name: z.string().describe('Prompt name'),
        title: z.string().optional().describe('Prompt title'),
        description: z.string().optional().describe('Prompt description'),
        arguments: z
            .array(PromptArgumentSchema)
            .optional()
            .describe('Array of argument definitions'),
        source: z.enum(['mcp', 'file', 'starter', 'custom']).describe('Source of the prompt'),
        metadata: z.record(z.unknown()).optional().describe('Additional metadata'),
    })
    .strict()
    .describe('Enhanced prompt information');

export type PromptInfo = z.output<typeof PromptInfoSchema>;

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
                details: z.unknown().optional().describe('Additional error details'),
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
