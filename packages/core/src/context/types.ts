import type { LLMProvider, TokenUsage } from '../llm/types.js';
import type { ToolDisplayData } from '../tools/display-types.js';

// =============================================================================
// Content Part Types
// =============================================================================

/**
 * Base interface for image data.
 * Supports multiple formats for flexibility across different use cases.
 */
export interface ImageData {
    image: string | Uint8Array | Buffer | ArrayBuffer | URL;
    mimeType?: string;
}

/**
 * Base interface for file data.
 * Supports multiple formats for flexibility across different use cases.
 */
export interface FileData {
    data: string | Uint8Array | Buffer | ArrayBuffer | URL;
    mimeType: string;
    filename?: string;
}

/**
 * Text content part.
 */
export interface TextPart {
    type: 'text';
    text: string;
}

/**
 * Image content part.
 */
export interface ImagePart extends ImageData {
    type: 'image';
}

/**
 * File content part.
 */
export interface FilePart extends FileData {
    type: 'file';
}

/**
 * UI Resource content part for MCP-UI interactive components.
 * Enables MCP servers to return rich, interactive UI (live streams, dashboards, forms).
 * @see https://mcpui.dev/ for MCP-UI specification
 */
export interface UIResourcePart {
    type: 'ui-resource';
    /** URI identifying the UI resource, must start with ui:// */
    uri: string;
    /** MIME type: text/html, text/uri-list, or application/vnd.mcp-ui.remote-dom */
    mimeType: string;
    /** Inline HTML content or URL (for text/html and text/uri-list) */
    content?: string;
    /** Base64-encoded content (alternative to content field) */
    blob?: string;
    /** Optional metadata for the UI resource */
    metadata?: {
        /** Display title for the UI resource */
        title?: string;
        /** Preferred rendering size in pixels */
        preferredSize?: { width: number; height: number };
    };
}

/**
 * Union of all content part types.
 * Discriminated by the `type` field.
 */
export type ContentPart = TextPart | ImagePart | FilePart | UIResourcePart;

// =============================================================================
// Content Part Type Guards
// =============================================================================

/**
 * Type guard for TextPart.
 */
export function isTextPart(part: ContentPart): part is TextPart {
    return part.type === 'text';
}

/**
 * Type guard for ImagePart.
 */
export function isImagePart(part: ContentPart): part is ImagePart {
    return part.type === 'image';
}

/**
 * Type guard for FilePart.
 */
export function isFilePart(part: ContentPart): part is FilePart {
    return part.type === 'file';
}

/**
 * Type guard for UIResourcePart.
 */
export function isUIResourcePart(part: ContentPart): part is UIResourcePart {
    return part.type === 'ui-resource';
}

// =============================================================================
// Tool Result Types
// =============================================================================

/**
 * Sanitized tool execution result with content parts and resource references.
 */
export interface SanitizedToolResult {
    /** Ordered content parts ready for rendering or provider formatting */
    content: ContentPart[];
    /**
     * Resource references created during sanitization (e.g. blob store URIs).
     * Consumers can dereference these via ResourceManager APIs.
     */
    resources?: Array<{
        uri: string;
        kind: 'image' | 'audio' | 'video' | 'binary';
        mimeType: string;
        filename?: string;
    }>;
    meta: {
        toolName: string;
        toolCallId: string;
        /** Whether the tool execution succeeded. Always set by sanitizeToolResult(). */
        success: boolean;
        /** Structured display data for tool-specific rendering (diffs, shell output, etc.) */
        display?: ToolDisplayData;
    };
}

// =============================================================================
// Shared Message Types
// =============================================================================

// TokenUsage imported from llm/types.ts (used by AssistantMessage)

/**
 * Tool call request from an assistant message.
 */
export interface ToolCall {
    /** Unique identifier for this tool call */
    id: string;
    /** The type of tool call (currently only 'function' is supported) */
    type: 'function';
    /** Function call details */
    function: {
        /** Name of the function to call */
        name: string;
        /** Arguments for the function in JSON string format */
        arguments: string;
    };
    /**
     * Provider-specific options (e.g., thought signatures for Gemini 3).
     * These are opaque tokens passed through to maintain model state across tool calls.
     * Not intended for display - purely for API round-tripping.
     */
    providerOptions?: Record<string, unknown>;
}

/**
 * Approval status for tool message executions.
 * (Not to be confused with ApprovalStatus enum from approval module)
 */
export type ToolApprovalStatus = 'pending' | 'approved' | 'rejected';

// =============================================================================
// Message Types (Discriminated Union by 'role')
// =============================================================================

/**
 * Base interface for all message types.
 * Contains fields common to all messages.
 */
interface MessageBase {
    /**
     * Unique message identifier (UUID).
     * Auto-generated by ContextManager.addMessage() if not provided.
     */
    id?: string;

    /**
     * Timestamp when the message was created (Unix timestamp in milliseconds).
     * Auto-generated by ContextManager.addMessage() if not provided.
     */
    timestamp?: number;

    /**
     * Optional metadata for the message.
     * Used for tracking summary status, original message IDs, etc.
     */
    metadata?: Record<string, unknown>;
}

/**
 * System message containing instructions or context for the LLM.
 */
export interface SystemMessage extends MessageBase {
    role: 'system';
    /** System prompt content as array of content parts */
    content: ContentPart[];
}

/**
 * User message containing end-user input.
 * Content can be text, images, files, or UI resources.
 */
export interface UserMessage extends MessageBase {
    role: 'user';
    /** User input content as array of content parts */
    content: ContentPart[];
}

/**
 * Assistant message containing LLM response.
 * May include text content, reasoning, and/or tool calls.
 */
export interface AssistantMessage extends MessageBase {
    role: 'assistant';
    /** Response content - null if message only contains tool calls */
    content: ContentPart[] | null;

    /**
     * Model reasoning text associated with this response.
     * Present when the provider supports reasoning and returns a final reasoning trace.
     */
    reasoning?: string;

    /** Token usage accounting for this response */
    tokenUsage?: TokenUsage;

    /** Model identifier that generated this response */
    model?: string;

    /** Provider identifier for this response */
    provider?: LLMProvider;

    /**
     * Tool calls requested by the assistant.
     * Present when the LLM requests tool execution.
     */
    toolCalls?: ToolCall[];
}

/**
 * Tool message containing the result of a tool execution.
 * Links back to the original tool call via toolCallId.
 */
export interface ToolMessage extends MessageBase {
    role: 'tool';
    /** Tool execution result as array of content parts */
    content: ContentPart[];

    /** ID of the tool call this message is responding to (REQUIRED) */
    toolCallId: string;

    /** Name of the tool that produced this result (REQUIRED) */
    name: string;

    /** Whether the tool execution was successful */
    success?: boolean;

    /** Whether this tool call required user approval before execution */
    requireApproval?: boolean;

    /** The approval status for this tool call */
    approvalStatus?: ToolApprovalStatus;

    /**
     * Timestamp when the tool output was compacted/pruned.
     * Present when the tool result has been summarized to save context space.
     */
    compactedAt?: number;

    /**
     * Structured display data for tool-specific rendering (diffs, shell output, etc.)
     * Persisted from SanitizedToolResult.meta.display for proper rendering on session resume.
     */
    displayData?: ToolDisplayData;
}

/**
 * Union of all message types.
 * Discriminated by the `role` field.
 *
 * Use type guards (isSystemMessage, isUserMessage, etc.) for type narrowing.
 */
export type InternalMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

// =============================================================================
// Message Type Guards
// =============================================================================

/**
 * Type guard for SystemMessage.
 */
export function isSystemMessage(msg: InternalMessage): msg is SystemMessage {
    return msg.role === 'system';
}

/**
 * Type guard for UserMessage.
 */
export function isUserMessage(msg: InternalMessage): msg is UserMessage {
    return msg.role === 'user';
}

/**
 * Type guard for AssistantMessage.
 */
export function isAssistantMessage(msg: InternalMessage): msg is AssistantMessage {
    return msg.role === 'assistant';
}

/**
 * Type guard for ToolMessage.
 */
export function isToolMessage(msg: InternalMessage): msg is ToolMessage {
    return msg.role === 'tool';
}
