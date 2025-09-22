/**
 * WebUI validation - imports validation schemas from ClientSDK
 * Single source of truth for API validation
 */

export {
    MessageRequestSchema,
    LLMSwitchRequestSchema,
    SessionCreateRequestSchema,
    ResetRequestSchema,
    McpServerRequestSchema,
    CatalogQuerySchema,
    SearchMessagesQuerySchema,
    SearchSessionsQuerySchema,
    GreetingQuerySchema,
    SessionIdQuerySchema,
    z,
    type CatalogQuery,
    type MessageRequest,
    type LLMSwitchRequest,
    type SessionCreateRequest,
    type ResetRequest,
    type McpServerRequest,
    type SearchMessagesQuery,
    type SearchSessionsQuery,
    type GreetingQuery,
    type SessionIdQuery,
} from '@dexto/client-sdk';
