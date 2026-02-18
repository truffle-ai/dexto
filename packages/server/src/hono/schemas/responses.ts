/**
 * Response schemas for OpenAPI documentation
 *
 * This file defines Zod schemas for all API response types, following these principles:
 * 1. Import reusable schemas from @dexto/core where available
 * 2. Define message/context schemas HERE (not in core) - see note below
 * 3. All schemas follow Zod best practices from CLAUDE.md (strict, describe, etc.)
 *
 * TYPE BOUNDARY: Core vs Server Schemas
 * -------------------------------------
 * Core's TypeScript interfaces use rich union types for binary data:
 *   `image: string | Uint8Array | Buffer | ArrayBuffer | URL`
 *
 * This allows internal code to work with various binary formats before serialization.
 * However, JSON API responses can only contain strings (base64-encoded).
 *
 * Server schemas use `z.string()` for these fields because:
 * 1. JSON serialization converts all binary data to base64 strings
 * 2. Hono client type inference works correctly with concrete types
 * 3. WebUI receives properly typed `string` instead of `JSONValue`
 *
 * CONSEQUENCE: Route handlers that return core types (e.g., `InternalMessage[]`)
 * need type casts when passing to `ctx.json()` because TypeScript sees the union
 * type from core but the schema expects just `string`. At runtime the data IS
 * already strings - the cast just bridges the static type mismatch.
 *
 * See routes/sessions.ts, routes/search.ts for examples with TODO comments.
 */

import { z } from 'zod';
import { LLMConfigBaseSchema as CoreLLMConfigBaseSchema, LLM_PROVIDERS } from '@dexto/core';

// TODO: Implement shared error response schemas for OpenAPI documentation.
// Currently, 404 and other error responses lack body schemas because @hono/zod-openapi
// enforces strict type matching between route definitions and handlers. When a 404 schema
// is defined, TypeScript expects handler return types to be a union of all response types,
// but the type system tries to match every return against every schema instead of by status code.
//
// Solution: Create a typed helper or wrapper that:
// 1. Defines a shared ErrorResponseSchema (e.g., { error: string, code?: string })
// 2. Properly types handlers to return discriminated unions by status code
// 3. Can be reused across all routes for consistent error documentation
//
// See: https://github.com/honojs/middleware/tree/main/packages/zod-openapi for patterns

// ============================================================================
// Imports from @dexto/core - Reusable schemas
// ============================================================================

// Memory schemas
export { MemorySchema } from '@dexto/core';

// LLM schemas
export { LLMConfigBaseSchema, type ValidatedLLMConfig } from '@dexto/core';

// ============================================================================
// Message/Context Schemas (defined here, not in core - see header comment)
// ============================================================================

export const TextPartSchema = z
    .object({
        type: z.literal('text').describe('Part type: text'),
        text: z.string().describe('Text content'),
    })
    .strict()
    .describe('Text content part');

export const ImagePartSchema = z
    .object({
        type: z.literal('image').describe('Part type: image'),
        image: z.string().describe('Base64-encoded image data'),
        mimeType: z.string().optional().describe('MIME type of the image'),
    })
    .strict()
    .describe('Image content part');

export const FilePartSchema = z
    .object({
        type: z.literal('file').describe('Part type: file'),
        data: z.string().describe('Base64-encoded file data'),
        mimeType: z.string().describe('MIME type of the file'),
        filename: z.string().optional().describe('Optional filename'),
    })
    .strict()
    .describe('File content part');

export const UIResourcePartSchema = z
    .object({
        type: z.literal('ui-resource').describe('Part type: ui-resource'),
        uri: z.string().describe('URI identifying the UI resource (must start with ui://)'),
        mimeType: z
            .string()
            .describe('MIME type: text/html, text/uri-list, or application/vnd.mcp-ui.remote-dom'),
        content: z.string().optional().describe('Inline HTML content or URL'),
        blob: z.string().optional().describe('Base64-encoded content (alternative to content)'),
        metadata: z
            .object({
                title: z.string().optional().describe('Display title for the UI resource'),
                preferredSize: z
                    .object({
                        width: z.number().describe('Preferred width in pixels'),
                        height: z.number().describe('Preferred height in pixels'),
                    })
                    .strict()
                    .optional()
                    .describe('Preferred rendering size'),
            })
            .strict()
            .optional()
            .describe('Optional metadata for the UI resource'),
    })
    .strict()
    .describe('UI Resource content part for MCP-UI interactive components');

export const ContentPartSchema = z
    .discriminatedUnion('type', [
        TextPartSchema,
        ImagePartSchema,
        FilePartSchema,
        UIResourcePartSchema,
    ])
    .describe('Message content part (text, image, file, or UI resource)');

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
            .strict()
            .describe('Function call details'),
    })
    .strict()
    .describe('Tool call made by the assistant');

export const TokenUsageSchema = z
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
        id: z.string().uuid().optional().describe('Unique message identifier (UUID)'),
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
        toolCalls: z.array(ToolCallSchema).optional().describe('Tool calls made by the assistant'),
        toolCallId: z.string().optional().describe('ID of the tool call this message responds to'),
        name: z.string().optional().describe('Name of the tool that produced this result'),
        success: z
            .boolean()
            .optional()
            .describe('Whether tool execution succeeded (present for role=tool messages)'),
    })
    .strict()
    .describe('Internal message representation');

// Derived types for consumers
export type TextPart = z.output<typeof TextPartSchema>;
export type ImagePart = z.output<typeof ImagePartSchema>;
export type FilePart = z.output<typeof FilePartSchema>;
export type ContentPart = z.output<typeof ContentPartSchema>;
export type ToolCall = z.output<typeof ToolCallSchema>;
export type TokenUsage = z.output<typeof TokenUsageSchema>;
export type InternalMessage = z.output<typeof InternalMessageSchema>;

// ============================================================================
// LLM Config Schemas
// ============================================================================

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
export { PermissionsConfigSchema } from '@dexto/core';

// Resource schemas
export { ResourceConfigSchema } from '@dexto/core';

// ============================================================================
// New schemas for types that don't have Zod equivalents in core
// ============================================================================

// --- Session Schemas ---

export const SessionTokenUsageSchema = z
    .object({
        inputTokens: z.number().int().nonnegative().describe('Number of input tokens'),
        outputTokens: z.number().int().nonnegative().describe('Number of output tokens'),
        reasoningTokens: z.number().int().nonnegative().describe('Number of reasoning tokens'),
        cacheReadTokens: z.number().int().nonnegative().describe('Number of cache read tokens'),
        cacheWriteTokens: z.number().int().nonnegative().describe('Number of cache write tokens'),
        totalTokens: z.number().int().nonnegative().describe('Total tokens used'),
    })
    .strict()
    .describe('Session-level token usage (all fields required for cumulative totals)');

export const ModelStatisticsSchema = z
    .object({
        provider: z.string().describe('LLM provider identifier'),
        model: z.string().describe('Model identifier'),
        messageCount: z
            .number()
            .int()
            .nonnegative()
            .describe('Number of messages using this model'),
        tokenUsage: SessionTokenUsageSchema.describe('Token usage for this model'),
        estimatedCost: z.number().nonnegative().describe('Estimated cost in USD for this model'),
        firstUsedAt: z.number().int().positive().describe('First use timestamp (Unix ms)'),
        lastUsedAt: z.number().int().positive().describe('Last use timestamp (Unix ms)'),
    })
    .strict()
    .describe('Per-model statistics within a session');

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
        tokenUsage: SessionTokenUsageSchema.optional().describe(
            'Aggregate token usage across all models'
        ),
        estimatedCost: z
            .number()
            .nonnegative()
            .optional()
            .describe('Total estimated cost in USD across all models'),
        modelStats: z
            .array(ModelStatisticsSchema)
            .optional()
            .describe('Per-model usage statistics (for multi-model sessions)'),
        workspaceId: z.string().optional().nullable().describe('Associated workspace ID, if any'),
    })
    .strict()
    .describe('Session metadata');

export type SessionTokenUsage = z.output<typeof SessionTokenUsageSchema>;
export type ModelStatistics = z.output<typeof ModelStatisticsSchema>;
export type SessionMetadata = z.output<typeof SessionMetadataSchema>;

// --- Workspace Schemas ---

export const WorkspaceSchema = z
    .object({
        id: z.string().describe('Workspace identifier'),
        path: z.string().describe('Workspace root path'),
        name: z.string().optional().nullable().describe('Optional workspace display name'),
        createdAt: z.number().int().positive().describe('Creation timestamp (Unix ms)'),
        lastActiveAt: z.number().int().positive().describe('Last active timestamp (Unix ms)'),
    })
    .strict()
    .describe('Workspace metadata');

export type Workspace = z.output<typeof WorkspaceSchema>;

// --- Schedule Schemas ---

export const ScheduleTaskSchema = z
    .object({
        instruction: z.string().describe('Instruction to execute'),
        metadata: z.record(z.unknown()).optional().describe('Optional task metadata'),
    })
    .strict()
    .describe('Schedule task definition');

export const ScheduleSchema = z
    .object({
        id: z.string().describe('Schedule ID'),
        name: z.string().describe('Schedule name'),
        cronExpression: z.string().describe('Cron expression'),
        timezone: z.string().describe('Timezone for schedule'),
        enabled: z.boolean().describe('Whether the schedule is enabled'),
        task: ScheduleTaskSchema.describe('Schedule task configuration'),
        sessionMode: z
            .enum(['ephemeral', 'dedicated', 'inherit', 'fixed'])
            .describe('Session context mode'),
        sessionId: z.string().optional().describe('Session ID when using fixed/inherit mode'),
        workspacePath: z.string().optional().describe('Workspace path override'),
        createdAt: z.number().int().positive().describe('Creation timestamp (Unix ms)'),
        updatedAt: z.number().int().positive().describe('Last update timestamp (Unix ms)'),
        lastRunAt: z.number().int().positive().optional().describe('Last run timestamp (Unix ms)'),
        nextRunAt: z.number().int().positive().optional().describe('Next run timestamp (Unix ms)'),
        runCount: z.number().int().nonnegative().describe('Total executions'),
        successCount: z.number().int().nonnegative().describe('Successful executions'),
        failureCount: z.number().int().nonnegative().describe('Failed executions'),
        lastError: z.string().optional().describe('Last execution error, if any'),
    })
    .strict()
    .describe('Automation schedule');

export type Schedule = z.output<typeof ScheduleSchema>;

export const ExecutionLogSchema = z
    .object({
        id: z.string().describe('Execution log ID'),
        scheduleId: z.string().describe('Schedule ID'),
        triggeredAt: z.number().int().positive().describe('Trigger timestamp (Unix ms)'),
        completedAt: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Completion timestamp (Unix ms)'),
        status: z.enum(['pending', 'success', 'failed', 'timeout']).describe('Execution status'),
        duration: z.number().int().nonnegative().optional().describe('Execution duration in ms'),
        error: z.string().optional().describe('Execution error, if any'),
        result: z.string().optional().describe('Execution result, if any'),
    })
    .strict()
    .describe('Schedule execution log');

export type ExecutionLog = z.output<typeof ExecutionLogSchema>;

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

export const MessageSearchResponseSchema = z
    .object({
        results: z.array(SearchResultSchema).describe('Array of search results'),
        total: z.number().int().nonnegative().describe('Total number of results available'),
        hasMore: z.boolean().describe('Whether there are more results beyond the current page'),
        query: z.string().describe('Query that was searched'),
    })
    .strict()
    .describe('Message search response');

export type MessageSearchResponse = z.output<typeof MessageSearchResponseSchema>;

export const SessionSearchResponseSchema = z
    .object({
        results: z.array(SessionSearchResultSchema).describe('Array of session search results'),
        total: z.number().int().nonnegative().describe('Total number of sessions with matches'),
        hasMore: z
            .boolean()
            .describe(
                'Always false - session search returns all matching sessions without pagination'
            ),
        query: z.string().describe('Query that was searched'),
    })
    .strict()
    .describe('Session search response');

export type SessionSearchResponse = z.output<typeof SessionSearchResponseSchema>;

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

// TODO: Consider refactoring to use discriminated union for better type safety:
// - MCP resources (source: 'mcp') should require serverName field
// - Internal resources (source: 'internal') should not have serverName field
// This would require updating core's ResourceMetadata interface to also use discriminated union
export const ResourceSchema = z
    .object({
        uri: z.string().describe('Resource URI'),
        name: z.string().optional().describe('Resource name'),
        description: z.string().optional().describe('Resource description'),
        mimeType: z.string().optional().describe('MIME type of the resource'),
        source: z.enum(['mcp', 'internal']).describe('Source system that provides this resource'),
        serverName: z
            .string()
            .optional()
            .describe('Original server/provider name (for MCP resources)'),
        size: z.number().optional().describe('Size of the resource in bytes (if known)'),
        lastModified: z
            .string()
            .datetime()
            .optional()
            .describe('Last modified timestamp (ISO 8601 string)'),
        metadata: z
            .record(z.unknown())
            .optional()
            .describe('Additional metadata specific to the resource type'),
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
        source: z.enum(['mcp', 'config', 'custom']).describe('Source of the prompt'),
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
