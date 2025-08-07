/**
 * Context-specific error codes
 * Includes initialization, message validation, token processing, and formatting errors
 */
export const enum ContextErrorCode {
    // Message validation
    MESSAGE_ROLE_MISSING = 'context_message_role_missing',
    MESSAGE_ROLE_UNKNOWN = 'context_message_role_unknown',
    MESSAGE_CONTENT_EMPTY = 'context_message_content_empty',
    MESSAGE_CONTENT_INVALID = 'context_message_content_invalid',

    // User message validation
    USER_MESSAGE_CONTENT_INVALID = 'context_user_message_content_invalid',

    // Assistant message validation
    ASSISTANT_MESSAGE_CONTENT_OR_TOOLS_REQUIRED = 'context_assistant_message_content_or_tools_required',
    ASSISTANT_MESSAGE_TOOL_CALLS_INVALID = 'context_assistant_message_tool_calls_invalid',

    // Tool message validation
    TOOL_MESSAGE_FIELDS_MISSING = 'context_tool_message_fields_missing',
    TOOL_CALL_ID_NAME_REQUIRED = 'context_tool_call_id_name_required',

    // System message validation
    SYSTEM_MESSAGE_CONTENT_INVALID = 'context_system_message_content_invalid',

    // Operation errors
    MESSAGE_SAVE_FAILED = 'context_message_save_failed',
    HISTORY_RETRIEVAL_FAILED = 'context_history_retrieval_failed',
    MESSAGE_FORMATTING_FAILED = 'context_message_formatting_failed',
    COMPRESSION_FAILED = 'context_compression_failed',
    SYSTEM_PROMPT_FORMATTING_FAILED = 'context_system_prompt_formatting_failed',

    // Token processing errors
    TOKEN_COUNT_FAILED = 'context_token_count_failed',

    // Message filtering errors
    PROVIDER_MODEL_REQUIRED = 'context_provider_model_required',

    // Compression strategy configuration errors
    COMPRESSION_CONFIG_INVALID = 'context_compression_config_invalid',
    PRESERVE_VALUES_NEGATIVE = 'context_preserve_values_negative',
    MIN_MESSAGES_NEGATIVE = 'context_min_messages_negative',
}
