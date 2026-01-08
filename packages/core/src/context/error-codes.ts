/**
 * Context-specific error codes
 * Includes initialization, message validation, token processing, and formatting errors
 */
export enum ContextErrorCode {
    // Message validation
    MESSAGE_ROLE_MISSING = 'context_message_role_missing',
    MESSAGE_CONTENT_EMPTY = 'context_message_content_empty',

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

    TOKEN_COUNT_FAILED = 'context_token_count_failed',
    // (removed) Operation/formatting wrappers; domain errors bubble up
    // (removed) Token processing wrappers; domain errors bubble up
    // (removed) Provider/model required; validated at LLM or agent layer

    // Compaction strategy configuration errors
    PRESERVE_VALUES_NEGATIVE = 'context_preserve_values_negative',
    MIN_MESSAGES_NEGATIVE = 'context_min_messages_negative',
    COMPACTION_INVALID_TYPE = 'context_compaction_invalid_type',
    COMPACTION_VALIDATION = 'context_compaction_validation',
    COMPACTION_MISSING_LLM = 'context_compaction_missing_llm',
    COMPACTION_PROVIDER_ALREADY_REGISTERED = 'context_compaction_provider_already_registered',

    // Message lookup errors
    MESSAGE_NOT_FOUND = 'context_message_not_found',
    MESSAGE_NOT_ASSISTANT = 'context_message_not_assistant',
    ASSISTANT_CONTENT_NOT_STRING = 'context_assistant_content_not_string',
}
