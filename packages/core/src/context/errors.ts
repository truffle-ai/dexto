import { DextoRuntimeError } from '../errors/index.js';
import { ErrorScope, ErrorType } from '../errors/types.js';
import { ContextErrorCode } from './error-codes.js';

/**
 * Context runtime error factory methods
 * Creates properly typed errors for context management operations
 */
export class ContextError {
    // Message validation errors
    static messageRoleMissing() {
        return new DextoRuntimeError(
            ContextErrorCode.MESSAGE_ROLE_MISSING,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            'Message must have a role',
            {},
            'Ensure all messages have a valid role field'
        );
    }

    static userMessageContentInvalid() {
        return new DextoRuntimeError(
            ContextErrorCode.USER_MESSAGE_CONTENT_INVALID,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            'User message content should be a non-empty string or a non-empty array of parts',
            {},
            'Provide valid content for user messages'
        );
    }

    static assistantMessageContentOrToolsRequired() {
        return new DextoRuntimeError(
            ContextErrorCode.ASSISTANT_MESSAGE_CONTENT_OR_TOOLS_REQUIRED,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            'Assistant message must have content or toolCalls',
            {},
            'Provide either content or toolCalls for assistant messages'
        );
    }

    static assistantMessageToolCallsInvalid() {
        return new DextoRuntimeError(
            ContextErrorCode.ASSISTANT_MESSAGE_TOOL_CALLS_INVALID,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            'Invalid toolCalls structure in assistant message',
            {},
            'Ensure toolCalls have proper structure with function name and arguments'
        );
    }

    static toolMessageFieldsMissing() {
        return new DextoRuntimeError(
            ContextErrorCode.TOOL_MESSAGE_FIELDS_MISSING,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            'Tool message missing required fields (toolCallId, name, content)',
            {},
            'Ensure tool messages have toolCallId, name, and content fields'
        );
    }

    static systemMessageContentInvalid() {
        return new DextoRuntimeError(
            ContextErrorCode.SYSTEM_MESSAGE_CONTENT_INVALID,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            'System message content must be a non-empty string',
            {},
            'Provide valid string content for system messages'
        );
    }

    static userMessageContentEmpty() {
        return new DextoRuntimeError(
            ContextErrorCode.MESSAGE_CONTENT_EMPTY,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            'Content must be a non-empty string or have imageData/fileData',
            {},
            'Provide non-empty content or attach image/file data'
        );
    }

    static toolCallIdNameRequired() {
        return new DextoRuntimeError(
            ContextErrorCode.TOOL_CALL_ID_NAME_REQUIRED,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            'toolCallId and name are required',
            {},
            'Provide both toolCallId and name for tool results'
        );
    }

    // Operation errors
    // Removed operation and tokenization/formatting wrappers; let domain errors bubble

    // Compression strategy configuration errors
    static preserveValuesNegative() {
        return new DextoRuntimeError(
            ContextErrorCode.PRESERVE_VALUES_NEGATIVE,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            'preserveStart and preserveEnd must be non-negative',
            {},
            'Set preserveStart and preserveEnd to zero or positive values'
        );
    }

    static tokenCountFailed(cause: string) {
        return new DextoRuntimeError(
            ContextErrorCode.TOKEN_COUNT_FAILED,
            ErrorScope.CONTEXT,
            ErrorType.SYSTEM,
            `Failed to count tokens: ${cause}`,
            { cause },
            'Check tokenizer implementation and message content structure'
        );
    }

    static minMessagesNegative() {
        return new DextoRuntimeError(
            ContextErrorCode.MIN_MESSAGES_NEGATIVE,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            'minMessagesToKeep must be non-negative',
            {},
            'Set minMessagesToKeep to zero or positive value'
        );
    }

    static compactionInvalidType(type: string, available: string[]) {
        return new DextoRuntimeError(
            ContextErrorCode.COMPACTION_INVALID_TYPE,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            `Unknown compaction provider type: '${type}'`,
            { type, available },
            `Use one of the available types: ${available.join(', ')}`
        );
    }

    static compactionValidation(type: string, errors: unknown) {
        return new DextoRuntimeError(
            ContextErrorCode.COMPACTION_VALIDATION,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            `Invalid configuration for compaction provider '${type}'`,
            { type, errors },
            'Check the configuration schema for this provider'
        );
    }

    static compactionMissingLLM(type: string) {
        return new DextoRuntimeError(
            ContextErrorCode.COMPACTION_MISSING_LLM,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            `Compaction provider '${type}' requires LLM service but none provided`,
            { type },
            'Ensure LLM service is initialized before creating this compaction provider'
        );
    }

    static compactionProviderAlreadyRegistered(type: string) {
        return new DextoRuntimeError(
            ContextErrorCode.COMPACTION_PROVIDER_ALREADY_REGISTERED,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            `Compaction provider '${type}' is already registered`,
            { type },
            'Each provider type can only be registered once'
        );
    }

    // Message lookup errors
    static messageNotFound(messageId: string) {
        return new DextoRuntimeError(
            ContextErrorCode.MESSAGE_NOT_FOUND,
            ErrorScope.CONTEXT,
            ErrorType.NOT_FOUND,
            `Message with ID ${messageId} not found`,
            { messageId }
        );
    }

    static messageNotAssistant(messageId: string) {
        return new DextoRuntimeError(
            ContextErrorCode.MESSAGE_NOT_ASSISTANT,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            `Message with ID ${messageId} is not an assistant message`,
            { messageId }
        );
    }

    static assistantContentNotString() {
        return new DextoRuntimeError(
            ContextErrorCode.ASSISTANT_CONTENT_NOT_STRING,
            ErrorScope.CONTEXT,
            ErrorType.USER,
            'Cannot append text to non-string assistant message content',
            {}
        );
    }
}
