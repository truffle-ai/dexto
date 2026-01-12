// packages/analytics/src/events.ts
// Shared analytics event types for CLI and WebUI

/**
 * Platform source for analytics events.
 * Used to distinguish which interface generated the event.
 */
export type AnalyticsSource = 'cli' | 'webui';

/**
 * LLM token consumption event.
 * Emitted after each LLM response with token usage data.
 *
 * Note: Optional properties use `| undefined` to support
 * passing undefined values with exactOptionalPropertyTypes.
 */
export interface LLMTokensConsumedEvent {
    source: AnalyticsSource;
    sessionId: string;
    provider?: string | undefined;
    model?: string | undefined;
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    reasoningTokens?: number | undefined;
    totalTokens?: number | undefined;
    cacheReadTokens?: number | undefined;
    cacheWriteTokens?: number | undefined;
}

/**
 * Message sent event.
 * Emitted when user sends a message to the agent.
 */
export interface MessageSentEvent {
    source: AnalyticsSource;
    sessionId: string;
    provider: string;
    model: string;
    hasImage: boolean;
    hasFile: boolean;
    messageLength: number;
    messageCount?: number | undefined;
    isQueued?: boolean | undefined;
}

/**
 * First message event (user activation).
 * Emitted only once per user, on their first message ever.
 */
export interface FirstMessageEvent {
    source: AnalyticsSource;
    provider: string;
    model: string;
    hasImage: boolean;
    hasFile: boolean;
    messageLength: number;
}

/**
 * Tool called event.
 * Emitted when a tool is invoked by the LLM.
 */
export interface ToolCalledEvent {
    source: AnalyticsSource;
    sessionId: string;
    toolName: string;
    mcpServer?: string | undefined;
    requiresApproval: boolean;
}

/**
 * Tool result event.
 * Emitted when a tool execution completes.
 */
export interface ToolResultEvent {
    source: AnalyticsSource;
    sessionId: string;
    toolName: string;
    success: boolean;
    durationMs?: number | undefined;
    approvalStatus?: 'approved' | 'rejected' | undefined;
}

/**
 * Session created event.
 */
export interface SessionCreatedEvent {
    source: AnalyticsSource;
    sessionId: string;
    trigger: 'first_message' | 'manual' | 'resume';
}

/**
 * Session reset event (conversation cleared).
 */
export interface SessionResetEvent {
    source: AnalyticsSource;
    sessionId: string;
    messageCount: number;
}

/**
 * LLM switched event.
 */
export interface LLMSwitchedEvent {
    source: AnalyticsSource;
    sessionId?: string | undefined;
    fromProvider: string;
    fromModel: string;
    toProvider: string;
    toModel: string;
    trigger: 'user_action' | 'config_change';
}

/**
 * Shared analytics event map.
 * All platforms use the same event names.
 */
export interface SharedAnalyticsEventMap {
    dexto_llm_tokens_consumed: LLMTokensConsumedEvent;
    dexto_message_sent: MessageSentEvent;
    dexto_first_message: FirstMessageEvent;
    dexto_tool_called: ToolCalledEvent;
    dexto_tool_result: ToolResultEvent;
    dexto_session_created: SessionCreatedEvent;
    dexto_session_reset: SessionResetEvent;
    dexto_llm_switched: LLMSwitchedEvent;
}

export type SharedAnalyticsEventName = keyof SharedAnalyticsEventMap;
