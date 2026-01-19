/**
 * Platform source for analytics events.
 * Used to distinguish which interface generated the event.
 */
export type AnalyticsSource = 'cli' | 'webui';

/**
 * LLM token consumption event.
 * Emitted after each LLM response with token usage data.
 *
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
    /** Estimated input tokens (before LLM call, using length/4 heuristic) */
    estimatedInputTokens?: number | undefined;
    /** Accuracy of estimate vs actual: (estimated - actual) / actual * 100 */
    estimateAccuracyPercent?: number | undefined;
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
 * Tool called event.
 * Emitted when a tool is invoked by the LLM.
 */
export interface ToolCalledEvent {
    source: AnalyticsSource;
    sessionId: string;
    toolName: string;
    mcpServer?: string | undefined;
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
 * Session switched event.
 * Emitted when user switches to a different session.
 */
export interface SessionSwitchedEvent {
    source: AnalyticsSource;
    fromSessionId: string | null;
    toSessionId: string;
}

/**
 * Agent switched event.
 * Emitted when user switches to a different agent.
 */
export interface AgentSwitchedEvent {
    source: AnalyticsSource;
    fromAgentId: string | null;
    toAgentId: string;
    toAgentName?: string | undefined;
    sessionId?: string | undefined;
}

/**
 * MCP server connected event.
 * Emitted when an MCP server connects successfully.
 */
export interface MCPServerConnectedEvent {
    source: AnalyticsSource;
    serverName: string;
    transportType: 'stdio' | 'http' | 'sse';
    toolCount?: number | undefined;
}

/**
 * File attached event.
 * Emitted when user attaches a file to a message.
 */
export interface FileAttachedEvent {
    source: AnalyticsSource;
    sessionId: string;
    fileType: string;
    fileSizeBytes?: number | undefined;
}

/**
 * Image attached event.
 * Emitted when user attaches an image to a message.
 */
export interface ImageAttachedEvent {
    source: AnalyticsSource;
    sessionId: string;
    imageType: string;
    imageSizeBytes?: number | undefined;
}

/**
 * File rejected event.
 * Emitted when a file attachment is rejected due to validation failure.
 */
export interface FileRejectedEvent {
    source: AnalyticsSource;
    sessionId: string;
    reason: 'size_limit' | 'type_unsupported' | 'count_limit' | 'duplicate' | 'total_size_limit';
    fileType: string;
    fileSizeBytes?: number | undefined;
}

/**
 * Shared analytics event map containing events supported by ALL platforms.
 * CLI and WebUI extend this map with platform-specific events.
 *
 * IMPORTANT: If an event is tracked by both CLI and WebUI, add it here.
 * Platform-specific events should be added to the respective platform's event map.
 */
export interface SharedAnalyticsEventMap {
    dexto_llm_tokens_consumed: LLMTokensConsumedEvent;
    dexto_message_sent: MessageSentEvent;
    dexto_tool_called: ToolCalledEvent;
    dexto_tool_result: ToolResultEvent;
    dexto_session_created: SessionCreatedEvent;
    dexto_session_reset: SessionResetEvent;
    dexto_llm_switched: LLMSwitchedEvent;
    dexto_session_switched: SessionSwitchedEvent;
    dexto_agent_switched: AgentSwitchedEvent;
    dexto_mcp_server_connected: MCPServerConnectedEvent;
    dexto_image_attached: ImageAttachedEvent;
    dexto_file_rejected: FileRejectedEvent;
}

export type SharedAnalyticsEventName = keyof SharedAnalyticsEventMap;
