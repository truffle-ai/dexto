import type { LLMRouter, LLMProvider } from '../llm/types.js';

/**
 * Internal representation of a message in a conversation.
 * Standardizes message format across different LLM providers.
 */
export interface ImageData {
    image: string | Uint8Array | Buffer | ArrayBuffer | URL;
    mimeType?: string;
}

export interface FileData {
    data: string | Uint8Array | Buffer | ArrayBuffer | URL;
    mimeType: string;
    filename?: string;
}

export interface TextPart {
    type: 'text';
    text: string;
}

export interface ImagePart extends ImageData {
    type: 'image';
}

export interface FilePart extends FileData {
    type: 'file';
}

export interface SanitizedToolResult {
    /** Ordered content parts ready for rendering or provider formatting */
    content: Array<TextPart | ImagePart | FilePart>;
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
        success?: boolean;
    };
}

export interface InternalMessage {
    /**
     * The role of the entity sending the message.
     * - 'system': System instructions or context
     * - 'user': End-user input
     * - 'assistant': LLM response
     * - 'tool': Result from a tool execution
     */
    role: 'system' | 'user' | 'assistant' | 'tool';

    /**
     * Timestamp when the message was created (Unix timestamp in milliseconds).
     * TODO: Populate this field when messages are created. Currently not implemented.
     * @see https://github.com/truffle-ai/dexto/issues/XXX
     */
    timestamp?: number;

    /**
     * The content of the message.
     * - String for system, assistant (text only), and tool messages.
     * - Array of parts for user messages (can include text, images, and files).
     * - null if an assistant message only contains tool calls.
     */
    content: string | null | Array<TextPart | ImagePart | FilePart>;

    /**
     * Optional model reasoning text associated with an assistant response.
     * Present when the provider supports reasoning and returns a final reasoning trace.
     */
    reasoning?: string;

    /**
     * Optional token usage accounting for this assistant response.
     */
    tokenUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        reasoningTokens?: number;
        totalTokens?: number;
    };

    /**
     * Optional model identifier for assistant messages.
     * Indicates which LLM model generated this response.
     */
    model?: string;

    /** Optional provider identifier for assistant messages. */
    provider?: LLMProvider;

    /**
     * Optional router metadata for assistant messages.
     * Indicates which router was used to route the request.
     */
    router?: LLMRouter;

    /**
     * Tool calls made by the assistant.
     * Only present in assistant messages when the LLM requests tool execution.
     */
    toolCalls?: Array<{
        /**
         * Unique identifier for this tool call
         */
        id: string;

        /**
         * The type of tool call (currently only 'function' is supported)
         */
        type: 'function';

        /**
         * Function call details
         */
        function: {
            /**
             * Name of the function to call
             */
            name: string;

            /**
             * Arguments for the function in JSON string format
             */
            arguments: string;
        };
    }>;

    /**
     * ID of the tool call this message is responding to.
     * Only present in tool messages.
     */
    toolCallId?: string;

    /**
     * Name of the tool that produced this result.
     * Only present in tool messages.
     */
    name?: string;
}
