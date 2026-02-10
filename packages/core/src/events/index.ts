import { EventEmitter } from 'events';
import type { LLMProvider } from '../llm/types.js';
import type { AgentRuntimeConfig } from '../agent/runtime-config.js';
import type { ApprovalRequest, ApprovalResponse } from '../approval/types.js';
import type { SanitizedToolResult } from '../context/types.js';

/**
 * LLM finish reason - why the LLM stopped generating
 *
 * Superset of Vercel AI SDK's LanguageModelV3FinishReason with app-specific additions.
 */
export type LLMFinishReason =
    // From Vercel AI SDK (LanguageModelV3FinishReason)
    | 'stop' // Normal completion
    | 'tool-calls' // Stopped to execute tool calls (more steps coming)
    | 'length' // Hit token/length limit
    | 'content-filter' // Content filter violation stopped the model
    | 'error' // Error occurred
    | 'other' // Other reason
    | 'unknown' // Model has not transmitted a finish reason
    // App-specific additions
    | 'cancelled' // User cancelled
    | 'max-steps'; // Hit max steps limit

/**
 * Agent-level event names - events that occur at the agent/global level
 */
export const AGENT_EVENT_NAMES = [
    'session:reset',
    'session:created',
    'session:title-updated',
    'session:override-set',
    'session:override-cleared',
    'mcp:server-connected',
    'mcp:server-added',
    'mcp:server-removed',
    'mcp:server-restarted',
    'mcp:server-updated',
    'mcp:resource-updated',
    'mcp:prompts-list-changed',
    'mcp:tools-list-changed',
    'tools:available-updated',
    'llm:switched',
    'state:changed',
    'state:exported',
    'state:reset',
    'resource:cache-invalidated',
    'approval:request',
    'approval:response',
    'run:invoke',
    'agent:stopped',
    'tool:background',
    'tool:background-completed',
] as const;

/**
 * Session-level event names - events that occur within individual sessions
 */
export const SESSION_EVENT_NAMES = [
    'llm:thinking',
    'llm:chunk',
    'llm:response',
    'llm:tool-call',
    'llm:tool-result',
    'llm:error',
    'llm:switched',
    'llm:unsupported-input',
    'tool:running',
    'context:compacting',
    'context:compacted',
    'context:pruned',
    'message:queued',
    'message:dequeued',
    'message:removed',
    'run:complete',
] as const;

/**
 * All event names combined for backward compatibility
 */
export const EVENT_NAMES = [...AGENT_EVENT_NAMES, ...SESSION_EVENT_NAMES] as const;

/**
 * Event Visibility Tiers
 *
 * These define which events are exposed through different APIs:
 * - STREAMING_EVENTS: Exposed via DextoAgent.stream() for real-time chat UIs
 * - INTEGRATION_EVENTS: Exposed via webhooks, A2A, and monitoring systems
 * - Internal events: Only available via direct EventBus access
 */

/**
 * Tier 1: Streaming Events
 *
 * Events exposed via DextoAgent.stream() for real-time streaming.
 * These are the most commonly used events for building chat UIs and
 * represent the core user-facing event stream.
 */
export const STREAMING_EVENTS = [
    // LLM events (session-scoped, forwarded to agent bus with sessionId)
    'llm:thinking',
    'llm:chunk',
    'llm:response',
    'llm:tool-call',
    'llm:tool-result',
    'llm:error',
    'llm:unsupported-input',

    // Tool execution events
    'tool:running',

    // Context management events
    'context:compacting',
    'context:compacted',
    'context:pruned',

    // Message queue events (for mid-task user guidance)
    'message:queued',
    'message:dequeued',

    // Run lifecycle events
    'run:complete',

    // Session metadata
    'session:title-updated',

    // Approval events (needed for tool confirmation in streaming UIs)
    'approval:request',
    'approval:response',

    // Service events (extensible pattern for non-core services)
    'service:event',
] as const;

/**
 * Tier 2: Integration Events
 *
 * Events exposed via webhooks, A2A subscriptions, and monitoring systems.
 * Includes all streaming events plus lifecycle and state management events
 * useful for external integrations.
 */
export const INTEGRATION_EVENTS = [
    ...STREAMING_EVENTS,

    // Session lifecycle
    'session:created',
    'session:reset',

    // MCP lifecycle
    'mcp:server-connected',
    'mcp:server-restarted',
    'mcp:tools-list-changed',
    'mcp:prompts-list-changed',

    // Tools
    'tools:available-updated',

    // LLM provider switching
    'llm:switched',

    // State management
    'state:changed',
] as const;

/**
 * Tier 3: Internal Events
 *
 * Events only exposed via direct AgentEventBus access for advanced use cases.
 * These are implementation details that may change between versions.
 *
 * Internal events include:
 * - resource:cache-invalidated
 * - state:exported
 * - state:reset
 * - mcp:server-added
 * - mcp:server-removed
 * - mcp:server-updated
 * - mcp:resource-updated
 * - session:override-set
 * - session:override-cleared
 */

export type StreamingEventName = (typeof STREAMING_EVENTS)[number];
export type IntegrationEventName = (typeof INTEGRATION_EVENTS)[number];
export type InternalEventName = Exclude<AgentEventName, IntegrationEventName>;

/**
 * Type helper to extract events by name from AgentEventMap
 */
export type AgentEventByName<T extends AgentEventName> = {
    name: T;
} & AgentEventMap[T];

/**
 * Union type of all streaming events with their payloads
 * Automatically derived from STREAMING_EVENTS const to stay in sync.
 * Uses 'name' property (not 'type') to avoid collision with payload fields like ApprovalRequest.type
 * These are the events that the message-stream API actually returns.
 */
export type StreamingEvent = {
    [K in StreamingEventName]: { name: K } & AgentEventMap[K];
}[StreamingEventName];

/**
 * Union type of all integration events with their payloads
 */
export type IntegrationEvent =
    | StreamingEvent
    | ({ name: 'session:created' } & AgentEventMap['session:created'])
    | ({ name: 'session:reset' } & AgentEventMap['session:reset'])
    | ({ name: 'mcp:server-connected' } & AgentEventMap['mcp:server-connected'])
    | ({ name: 'mcp:server-restarted' } & AgentEventMap['mcp:server-restarted'])
    | ({ name: 'mcp:tools-list-changed' } & AgentEventMap['mcp:tools-list-changed'])
    | ({ name: 'mcp:prompts-list-changed' } & AgentEventMap['mcp:prompts-list-changed'])
    | ({ name: 'tools:available-updated' } & AgentEventMap['tools:available-updated'])
    | ({ name: 'llm:switched' } & AgentEventMap['llm:switched'])
    | ({ name: 'state:changed' } & AgentEventMap['state:changed']);

/**
 * Combined event map for the agent bus - includes agent events and session events with sessionId
 * This is what the global agent event bus uses to aggregate all events
 */
export interface AgentEventMap {
    // Session events
    /** Fired when session conversation is reset */
    'session:reset': {
        sessionId: string;
    };

    /** Fired when a new session is created and should become active */
    'session:created': {
        sessionId: string | null; // null means clear without creating (deferred creation)
        switchTo: boolean; // Whether UI should switch to this session
    };

    /** Fired when a session's human-friendly title is updated */
    'session:title-updated': {
        sessionId: string;
        title: string;
    };

    /** Fired when session override is set */
    'session:override-set': {
        sessionId: string;
        override: any; // SessionOverride type
    };

    /** Fired when session override is cleared */
    'session:override-cleared': {
        sessionId: string;
    };

    // MCP events
    /** Fired when MCP server connection succeeds or fails */
    'mcp:server-connected': {
        name: string;
        success: boolean;
        error?: string;
    };

    /** Fired when MCP server is added to runtime state */
    'mcp:server-added': {
        serverName: string;
        config: any; // McpServerConfig type
    };

    /** Fired when MCP server is removed from runtime state */
    'mcp:server-removed': {
        serverName: string;
    };

    /** Fired when MCP server is restarted */
    'mcp:server-restarted': {
        serverName: string;
    };

    /** Fired when MCP server is updated in runtime state */
    'mcp:server-updated': {
        serverName: string;
        config: any; // McpServerConfig type
    };

    /** Fired when MCP server resource is updated */
    'mcp:resource-updated': {
        serverName: string;
        resourceUri: string;
    };

    /** Fired when MCP server prompts list changes */
    'mcp:prompts-list-changed': {
        serverName: string;
        prompts: string[];
    };

    /** Fired when MCP server tools list changes */
    'mcp:tools-list-changed': {
        serverName: string;
        tools: string[];
    };

    // Tools events
    /** Fired when available tools list updates */
    'tools:available-updated': {
        tools: string[];
        source: 'mcp' | 'builtin';
    };

    /** Fired when enabled/disabled tools list updates */
    'tools:enabled-updated': {
        scope: 'global' | 'session';
        sessionId?: string;
        disabledTools: string[];
    };

    /**
     * Agent run is being invoked externally (e.g., by scheduler, A2A, API).
     * Fired BEFORE agent.stream()/run() is called.
     * UI can use this to display the incoming prompt and set up streaming subscriptions.
     */
    'run:invoke': {
        /** The session this run will execute in */
        sessionId: string;
        /** The prompt/content being sent */
        content: import('../context/types.js').ContentPart[];
        /** Source of the invocation */
        source: 'scheduler' | 'a2a' | 'api' | 'external';
        /** Optional metadata about the invocation */
        metadata?: Record<string, unknown>;
    };

    // LLM events (forwarded from session bus with sessionId added)
    /** LLM service started thinking */
    'llm:thinking': {
        sessionId: string;
    };

    /** LLM service sent a streaming chunk */
    'llm:chunk': {
        chunkType: 'text' | 'reasoning';
        content: string;
        isComplete?: boolean;
        sessionId: string;
    };

    /** LLM service final response */
    'llm:response': {
        content: string;
        reasoning?: string;
        provider?: LLMProvider;
        model?: string;
        tokenUsage?: {
            inputTokens?: number;
            outputTokens?: number;
            reasoningTokens?: number;
            totalTokens?: number;
            cacheReadTokens?: number;
            cacheWriteTokens?: number;
        };
        /** Estimated input tokens before LLM call (for analytics/calibration) */
        estimatedInputTokens?: number;
        /** Finish reason: 'tool-calls' means more steps coming, others indicate completion */
        finishReason?: LLMFinishReason;
        sessionId: string;
    };

    /** LLM service requested a tool call */
    'llm:tool-call': {
        toolName: string;
        args: Record<string, any>;
        callId?: string;
        sessionId: string;
    };

    /** LLM service returned a tool result */
    'llm:tool-result': {
        toolName: string;
        callId?: string;
        success: boolean;
        /** Sanitized result - present when success=true */
        sanitized?: SanitizedToolResult;
        rawResult?: unknown;
        /** Error message - present when success=false */
        error?: string;
        /** Whether this tool required user approval */
        requireApproval?: boolean;
        /** The approval status (only present if requireApproval is true) */
        approvalStatus?: 'approved' | 'rejected';
        sessionId: string;
    };

    /** Tool execution actually started (after approval if needed) */
    'tool:running': {
        toolName: string;
        toolCallId: string;
        sessionId: string;
    };

    /** LLM service error */
    'llm:error': {
        error: Error;
        context?: string;
        recoverable?: boolean;
        /** Tool call ID if error occurred during tool execution */
        toolCallId?: string;
        sessionId: string;
    };

    /** LLM service switched */
    'llm:switched': {
        newConfig: any; // LLMConfig type
        historyRetained?: boolean;
        sessionIds: string[]; // Array of affected session IDs
    };

    /** LLM service unsupported input */
    'llm:unsupported-input': {
        errors: string[];
        provider: LLMProvider;
        model?: string;
        fileType?: string;
        details?: any;
        sessionId: string;
    };

    /** Context compaction is starting */
    'context:compacting': {
        /** Estimated tokens that triggered compaction */
        estimatedTokens: number;
        sessionId: string;
    };

    /** Context was compacted during multi-step tool calling */
    'context:compacted': {
        /** Actual input tokens from API that triggered compaction */
        originalTokens: number;
        /** Estimated tokens after compaction (simple length/4 heuristic) */
        compactedTokens: number;
        originalMessages: number;
        compactedMessages: number;
        strategy: string;
        reason: 'overflow' | 'manual';
        sessionId: string;
    };

    /** Old tool outputs were pruned (marked with compactedAt) to save tokens */
    'context:pruned': {
        prunedCount: number;
        savedTokens: number;
        sessionId: string;
    };

    /** Context was manually cleared via /clear command */
    'context:cleared': {
        sessionId: string;
    };

    /** User message was queued during agent execution */
    'message:queued': {
        position: number;
        id: string;
        sessionId: string;
    };

    /** Queued messages were dequeued and injected into context */
    'message:dequeued': {
        count: number;
        ids: string[];
        coalesced: boolean;
        /** Combined content of all dequeued messages (for UI display) */
        content: import('../context/types.js').ContentPart[];
        sessionId: string;
        /** Raw dequeued messages (optional) */
        messages?: import('../session/types.js').QueuedMessage[];
    };

    /** Queued message was removed from queue */
    'message:removed': {
        id: string;
        sessionId: string;
    };

    /** Agent run completed (all steps done, no queued messages remaining) */
    'run:complete': {
        /** How the run ended */
        finishReason: LLMFinishReason;
        /** Number of steps executed */
        stepCount: number;
        /** Total wall-clock duration of the run in milliseconds */
        durationMs: number;
        /** Error that caused termination (only if finishReason === 'error') */
        error?: Error;
        sessionId: string;
    };

    // State events
    /** Fired when agent runtime state changes */
    'state:changed': {
        field: string; // keyof AgentRuntimeState
        oldValue: any;
        newValue: any;
        sessionId?: string;
    };

    /** Fired when agent state is exported as config */
    'state:exported': {
        config: AgentRuntimeConfig;
    };

    /** Fired when agent state is reset to baseline */
    'state:reset': {
        toConfig: any; // AgentConfig type
    };

    // Resource events
    /** Fired when resource cache should be invalidated */
    'resource:cache-invalidated': {
        resourceUri?: string;
        serverName: string;
        action: 'updated' | 'server_connected' | 'server_removed' | 'blob_stored';
    };

    // Approval events - use ApprovalRequest directly
    // No transformation needed since we use 'name' (not 'type') as SSE discriminant
    /** Fired when user approval is requested (generalized approval system) */
    'approval:request': ApprovalRequest;

    /** Fired when user approval response is received */
    'approval:response': ApprovalResponse;

    /**
     * Extensible service event for non-core/additive services.
     * Allows services like agent-spawner, process-tools, etc. to emit events
     * without polluting the core event namespace.
     */
    'service:event': {
        /** Service identifier (e.g., 'agent-spawner', 'process-tools') */
        service: string;
        /** Event type within the service (e.g., 'progress', 'stdout') */
        event: string;
        /** Links this event to a parent tool call */
        toolCallId?: string;
        /** Session this event belongs to */
        sessionId: string;
        /** Arbitrary event data - service-specific payload */
        data: Record<string, unknown>;
    };

    /**
     * Fired when a tool is executed in background.
     * Used by orchestration layer to register the task.
     */
    'tool:background': {
        toolName: string;
        toolCallId: string;
        sessionId: string;
        description?: string;
        promise: Promise<unknown>;
        timeoutMs?: number;
        notifyOnComplete?: boolean;
    };

    /**
     * Fired when a background tool has completed registration.
     */
    'tool:background-completed': {
        toolCallId: string;
        sessionId: string;
    };

    /**
     * Fired when the agent is fully stopped.
     */
    'agent:stopped': void;
}

export type ToolBackgroundEvent = AgentEventMap['tool:background'];

/**
 * Session-level events - these occur within individual sessions without session context
 * (since they're already scoped to a session)
 */
export interface SessionEventMap {
    /** LLM service started thinking */
    'llm:thinking': void;

    /** LLM service sent a streaming chunk */
    'llm:chunk': {
        chunkType: 'text' | 'reasoning';
        content: string;
        isComplete?: boolean;
    };

    /** LLM service final response */
    'llm:response': {
        content: string;
        reasoning?: string;
        provider?: LLMProvider;
        model?: string;
        tokenUsage?: {
            inputTokens?: number;
            outputTokens?: number;
            reasoningTokens?: number;
            totalTokens?: number;
            cacheReadTokens?: number;
            cacheWriteTokens?: number;
        };
        /** Estimated input tokens before LLM call (for analytics/calibration) */
        estimatedInputTokens?: number;
        /** Finish reason: 'tool-calls' means more steps coming, others indicate completion */
        finishReason?: LLMFinishReason;
    };

    /** LLM service requested a tool call */
    'llm:tool-call': {
        toolName: string;
        args: Record<string, any>;
        callId?: string;
    };

    /** LLM service returned a tool result */
    'llm:tool-result': {
        toolName: string;
        callId?: string;
        success: boolean;
        /** Sanitized result - present when success=true */
        sanitized?: SanitizedToolResult;
        rawResult?: unknown;
        /** Error message - present when success=false */
        error?: string;
        /** Whether this tool required user approval */
        requireApproval?: boolean;
        /** The approval status (only present if requireApproval is true) */
        approvalStatus?: 'approved' | 'rejected';
    };

    /** Tool execution actually started (after approval if needed) */
    'tool:running': {
        toolName: string;
        toolCallId: string;
    };

    /** LLM service error */
    'llm:error': {
        error: Error;
        context?: string;
        recoverable?: boolean;
        /** Tool call ID if error occurred during tool execution */
        toolCallId?: string;
    };

    /** LLM service switched */
    'llm:switched': {
        newConfig: any; // LLMConfig type
        historyRetained?: boolean;
    };

    /** LLM service unsupported input */
    'llm:unsupported-input': {
        errors: string[];
        provider: LLMProvider;
        model?: string;
        fileType?: string;
        details?: any;
    };

    /** Context compaction is starting */
    'context:compacting': {
        /** Estimated tokens that triggered compaction */
        estimatedTokens: number;
    };

    /** Context was compacted during multi-step tool calling */
    'context:compacted': {
        /** Actual input tokens from API that triggered compaction */
        originalTokens: number;
        /** Estimated tokens after compaction (simple length/4 heuristic) */
        compactedTokens: number;
        originalMessages: number;
        compactedMessages: number;
        strategy: string;
        reason: 'overflow' | 'manual';
    };

    /** Old tool outputs were pruned (marked with compactedAt) to save tokens */
    'context:pruned': {
        prunedCount: number;
        savedTokens: number;
    };

    /** User message was queued during agent execution */
    'message:queued': {
        position: number;
        id: string;
    };

    /** Queued messages were dequeued and injected into context */
    'message:dequeued': {
        count: number;
        ids: string[];
        coalesced: boolean;
        /** Combined content of all dequeued messages (for UI display) */
        content: import('../context/types.js').ContentPart[];
        /** Raw dequeued messages (optional) */
        messages?: import('../session/types.js').QueuedMessage[];
    };

    /** Queued message was removed from queue */
    'message:removed': {
        id: string;
    };

    /** Agent run completed (all steps done, no queued messages remaining) */
    'run:complete': {
        /** How the run ended */
        finishReason: LLMFinishReason;
        /** Number of steps executed */
        stepCount: number;
        /** Total wall-clock duration of the run in milliseconds */
        durationMs: number;
        /** Error that caused termination (only if finishReason === 'error') */
        error?: Error;
    };
}

export type AgentEventName = keyof AgentEventMap;
export type SessionEventName = keyof SessionEventMap;
export type EventName = keyof AgentEventMap;

/**
 * Compile-time checks to ensure event name arrays and maps stay synchronized
 */
type _AgentEventNamesInMap = (typeof AGENT_EVENT_NAMES)[number] extends keyof AgentEventMap
    ? true
    : never;
type _SessionEventNamesInMap = (typeof SESSION_EVENT_NAMES)[number] extends SessionEventName
    ? true
    : never;
type _EventNamesInMap = (typeof EVENT_NAMES)[number] extends EventName ? true : never;

const _checkAgentEventNames: _AgentEventNamesInMap = true;
const _checkSessionEventNames: _SessionEventNamesInMap = true;
const _checkEventNames: _EventNamesInMap = true;

// Explicitly mark compile-time checks as used to avoid linter warnings
void _checkAgentEventNames;
void _checkSessionEventNames;
void _checkEventNames;

/**
 * Runtime arrays of event names for iteration, validation, etc.
 */
export const AgentEventNames: readonly AgentEventName[] = Object.freeze([...AGENT_EVENT_NAMES]);
export const SessionEventNames: readonly SessionEventName[] = Object.freeze([
    ...SESSION_EVENT_NAMES,
]);
export const EventNames: readonly EventName[] = Object.freeze([...EVENT_NAMES]);

/**
 * Generic typed EventEmitter base class using composition instead of inheritance
 * This provides full compile-time type safety by not extending EventEmitter
 *
 * Exported for extension by packages like multi-agent-server that need custom event buses.
 */
export class BaseTypedEventEmitter<TEventMap extends Record<string, any>> {
    // Wrapped EventEmitter instance
    private _emitter = new EventEmitter();

    // Store listeners with their abort controllers for cleanup
    // Maps AbortSignal -> Event Name -> Set of listener functions
    private _abortListeners = new WeakMap<AbortSignal, Map<keyof TEventMap, Set<Function>>>();

    /**
     * Emit an event with type-safe payload
     */
    emit<K extends keyof TEventMap>(
        event: K,
        ...args: TEventMap[K] extends void ? [] : [TEventMap[K]]
    ): boolean {
        return this._emitter.emit(event as string, ...args);
    }

    /**
     * Subscribe to an event with type-safe listener
     */
    on<K extends keyof TEventMap>(
        event: K,
        listener: TEventMap[K] extends void ? () => void : (payload: TEventMap[K]) => void,
        options?: { signal?: AbortSignal }
    ): this {
        // If signal is already aborted, don't add the listener
        if (options?.signal?.aborted) {
            return this;
        }

        // Add the listener
        this._emitter.on(event as string, listener);

        // Set up abort handling if signal is provided
        if (options?.signal) {
            const signal = options.signal;

            // Track this listener for cleanup using Map -> Set structure
            if (!this._abortListeners.has(signal)) {
                this._abortListeners.set(signal, new Map());
            }
            const eventMap = this._abortListeners.get(signal)!;
            if (!eventMap.has(event)) {
                eventMap.set(event, new Set());
            }
            eventMap.get(event)!.add(listener as Function);

            // Set up abort handler
            const abortHandler = () => {
                this.off(event, listener);

                // Clean up tracking
                const eventMap = this._abortListeners.get(signal);
                if (eventMap) {
                    const listenerSet = eventMap.get(event);
                    if (listenerSet) {
                        listenerSet.delete(listener as Function);
                        if (listenerSet.size === 0) {
                            eventMap.delete(event);
                        }
                    }
                    if (eventMap.size === 0) {
                        this._abortListeners.delete(signal);
                    }
                }
            };

            signal.addEventListener('abort', abortHandler, { once: true });
        }

        return this;
    }

    /**
     * Subscribe to an event once with type-safe listener
     */
    once<K extends keyof TEventMap>(
        event: K,
        listener: TEventMap[K] extends void ? () => void : (payload: TEventMap[K]) => void,
        options?: { signal?: AbortSignal }
    ): this {
        // If signal is already aborted, don't add the listener
        if (options?.signal?.aborted) {
            return this;
        }

        // Create a wrapper that handles both once and abort cleanup
        const onceWrapper = (...args: any[]) => {
            // Clean up abort tracking before calling the original listener
            if (options?.signal) {
                const eventMap = this._abortListeners.get(options.signal);
                if (eventMap) {
                    const listenerSet = eventMap.get(event);
                    if (listenerSet) {
                        listenerSet.delete(onceWrapper);
                        if (listenerSet.size === 0) {
                            eventMap.delete(event);
                        }
                    }
                    if (eventMap.size === 0) {
                        this._abortListeners.delete(options.signal);
                    }
                }
            }
            (listener as any)(...args);
        };

        // Add the wrapped listener
        this._emitter.once(event as string, onceWrapper);

        // Set up abort handling if signal is provided
        if (options?.signal) {
            const signal = options.signal;

            // Track this listener for cleanup using Map -> Set structure
            if (!this._abortListeners.has(signal)) {
                this._abortListeners.set(signal, new Map());
            }
            const eventMap = this._abortListeners.get(signal)!;
            if (!eventMap.has(event)) {
                eventMap.set(event, new Set());
            }
            eventMap.get(event)!.add(onceWrapper);

            // Set up abort handler
            const abortHandler = () => {
                this.off(event, onceWrapper);

                // Clean up tracking
                const eventMap = this._abortListeners.get(signal);
                if (eventMap) {
                    const listenerSet = eventMap.get(event);
                    if (listenerSet) {
                        listenerSet.delete(onceWrapper);
                        if (listenerSet.size === 0) {
                            eventMap.delete(event);
                        }
                    }
                    if (eventMap.size === 0) {
                        this._abortListeners.delete(signal);
                    }
                }
            };

            signal.addEventListener('abort', abortHandler, { once: true });
        }

        return this;
    }

    /**
     * Unsubscribe from an event
     */
    off<K extends keyof TEventMap>(
        event: K,
        listener: TEventMap[K] extends void ? () => void : (payload: TEventMap[K]) => void
    ): this {
        this._emitter.off(event as string, listener);
        return this;
    }
}

/**
 * Agent-level typed event emitter for global agent events
 */
export class AgentEventBus extends BaseTypedEventEmitter<AgentEventMap> {}

/**
 * Session-level typed event emitter for session-scoped events
 */
export class SessionEventBus extends BaseTypedEventEmitter<SessionEventMap> {}

/**
 * Combined typed event emitter for backward compatibility
 */
export class TypedEventEmitter extends BaseTypedEventEmitter<AgentEventMap> {}

/**
 * Global shared event bus (backward compatibility)
 */
export const eventBus = new TypedEventEmitter();
