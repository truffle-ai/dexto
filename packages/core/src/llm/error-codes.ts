/**
 * LLM-specific error codes
 * Includes configuration, validation, and runtime errors for LLM operations
 */
export enum LLMErrorCode {
    // Configuration errors
    API_KEY_MISSING = 'llm_api_key_missing',
    API_KEY_INVALID = 'llm_api_key_invalid', // Too short, wrong format
    API_KEY_CANDIDATE_MISSING = 'llm_api_key_candidate_missing',
    BASE_URL_MISSING = 'llm_base_url_missing',
    BASE_URL_INVALID = 'llm_base_url_invalid',
    CONFIG_MISSING = 'llm_config_missing', // Required config (e.g., GOOGLE_VERTEX_PROJECT)

    // Model/Provider compatibility
    MODEL_INCOMPATIBLE = 'llm_model_incompatible',
    MODEL_UNKNOWN = 'llm_model_unknown',
    PROVIDER_UNSUPPORTED = 'llm_provider_unsupported',

    // Input validation (formerly generic "validation")
    INPUT_FILE_UNSUPPORTED = 'llm_input_file_unsupported',
    INPUT_IMAGE_UNSUPPORTED = 'llm_input_image_unsupported',
    INPUT_TEXT_INVALID = 'llm_input_text_invalid',

    // Limits
    TOKENS_EXCEEDED = 'llm_tokens_exceeded',
    RATE_LIMIT_EXCEEDED = 'llm_rate_limit_exceeded',
    INSUFFICIENT_CREDITS = 'llm_insufficient_credits',

    // Operations
    SWITCH_FAILED = 'llm_switch_failed',
    GENERATION_FAILED = 'llm_generation_failed',

    // Input validation (moved from agent)
    SWITCH_INPUT_MISSING = 'llm_switch_input_missing', // At least model or provider must be specified

    // Schema validation
    REQUEST_INVALID_SCHEMA = 'llm_request_invalid_schema',
}
