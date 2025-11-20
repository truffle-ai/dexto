import { EventEmitter } from 'events';
import type { LLMProvider, LLMRouter } from '../llm/types.js';
import { ValidatedAgentConfig } from '../agent/schemas.js';
import { ApprovalStatus, DenialReason } from '../approval/types.js';
import type { SanitizedToolResult } from '../context/types.js';

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

    // Session metadata
    'session:title-updated',
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
    type: T;
} & AgentEventMap[T];

/**
 * Union type of all streaming events with their payloads
 * Maps each event name to its payload from AgentEventMap, adding a type property
 */
export type StreamingEvent =
    | ({ type: 'llm:thinking' } & AgentEventMap['llm:thinking'])
    | ({ type: 'llm:chunk' } & AgentEventMap['llm:chunk'])
    | ({ type: 'llm:response' } & AgentEventMap['llm:response'])
    | ({ type: 'llm:tool-call' } & AgentEventMap['llm:tool-call'])
    | ({ type: 'llm:tool-result' } & AgentEventMap['llm:tool-result'])
    | ({ type: 'llm:error' } & AgentEventMap['llm:error'])
    | ({ type: 'llm:unsupported-input' } & AgentEventMap['llm:unsupported-input'])
    | ({ type: 'session:title-updated' } & AgentEventMap['session:title-updated']);

/**
 * Union type of all integration events with their payloads
 */
export type IntegrationEvent =
    | StreamingEvent
    | ({ type: 'session:created' } & AgentEventMap['session:created'])
    | ({ type: 'session:reset' } & AgentEventMap['session:reset'])
    | ({ type: 'mcp:server-connected' } & AgentEventMap['mcp:server-connected'])
    | ({ type: 'mcp:server-restarted' } & AgentEventMap['mcp:server-restarted'])
    | ({ type: 'mcp:tools-list-changed' } & AgentEventMap['mcp:tools-list-changed'])
    | ({ type: 'mcp:prompts-list-changed' } & AgentEventMap['mcp:prompts-list-changed'])
    | ({ type: 'tools:available-updated' } & AgentEventMap['tools:available-updated'])
    | ({ type: 'llm:switched' } & AgentEventMap['llm:switched'])
    | ({ type: 'state:changed' } & AgentEventMap['state:changed']);

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
        sessionId: string;
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
        router?: LLMRouter;
        tokenUsage?: {
            inputTokens?: number;
            outputTokens?: number;
            reasoningTokens?: number;
            totalTokens?: number;
        };
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
        sanitized: SanitizedToolResult;
        rawResult?: unknown;
        sessionId: string;
    };

    /** LLM service error */
    'llm:error': {
        error: Error;
        context?: string;
        recoverable?: boolean;
        sessionId: string;
    };

    /** LLM service switched */
    'llm:switched': {
        newConfig: any; // LLMConfig type
        router?: string;
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
        config: ValidatedAgentConfig;
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

    // Approval events
    /** Fired when user approval is requested (generalized approval system) */
    'approval:request': {
        approvalId: string;
        type: string; // ApprovalType enum as string
        sessionId?: string;
        timeout?: number;
        timestamp: Date;
        metadata: Record<string, any>;
    };

    /** Fired when user approval response is received */
    'approval:response': {
        approvalId: string;
        status: ApprovalStatus;
        sessionId?: string | undefined;
        data?: Record<string, any> | undefined;
        reason?: DenialReason | undefined;
        message?: string | undefined;
    };
}

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
        router?: LLMRouter;
        tokenUsage?: {
            inputTokens?: number;
            outputTokens?: number;
            reasoningTokens?: number;
            totalTokens?: number;
        };
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
        sanitized: SanitizedToolResult;
        rawResult?: unknown;
    };

    /** LLM service error */
    'llm:error': {
        error: Error;
        context?: string;
        recoverable?: boolean;
    };

    /** LLM service switched */
    'llm:switched': {
        newConfig: any; // LLMConfig type
        router?: string;
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
 */
class BaseTypedEventEmitter<TEventMap extends Record<string, any>> {
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
