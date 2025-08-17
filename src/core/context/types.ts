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
