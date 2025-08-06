import { EventEmitter } from 'events';
import { LLMProvider } from '../llm/registry.js';

/**
 * Agent-level event names - events that occur at the agent/global level
 */
export const AGENT_EVENT_NAMES = [
    'dexto:conversationReset',
    'dexto:mcpServerConnected',
    'dexto:availableToolsUpdated',
    'dexto:llmSwitched',
    // Agent state manager events
    'dexto:stateChanged',
    'dexto:stateExported',
    'dexto:stateReset',
    'dexto:sessionOverrideSet',
    'dexto:sessionOverrideCleared',
    'dexto:mcpServerAdded',
    'dexto:mcpServerRemoved',
    'dexto:mcpServerUpdated',
    // Tool confirmation events
    'dexto:toolConfirmationRequest',
    'dexto:toolConfirmationResponse',
] as const;

/**
 * Session-level event names - events that occur within individual sessions
 */
export const SESSION_EVENT_NAMES = [
    'llmservice:thinking',
    'llmservice:chunk',
    'llmservice:response',
    'llmservice:toolCall',
    'llmservice:toolResult',
    'llmservice:error',
    'llmservice:switched',
    'llmservice:unsupportedInput',
] as const;

/**
 * All event names combined for backward compatibility
 */
export const EVENT_NAMES = [...AGENT_EVENT_NAMES, ...SESSION_EVENT_NAMES] as const;

/**
 * Combined event map for the agent bus - includes agent events and session events with sessionId
 * This is what the global agent event bus uses to aggregate all events
 */
export interface AgentEventMap {
    // Agent-level events
    /** Fired when Dexto conversation is reset */
    'dexto:conversationReset': {
        sessionId: string;
    };

    /** Fired when MCP server connection succeeds or fails */
    'dexto:mcpServerConnected': {
        name: string;
        success: boolean;
        error?: string;
    };

    /** Fired when available tools list updates */
    'dexto:availableToolsUpdated': {
        tools: string[];
        source: 'mcp' | 'builtin';
    };

    /** Fired when LLM service switched */
    'dexto:llmSwitched': {
        newConfig: any; // LLMConfig type
        router?: string;
        historyRetained?: boolean;
        sessionIds: string[];
    };

    // Session events forwarded to agent bus (with sessionId added)
    /** LLM service started thinking */
    'llmservice:thinking': {
        sessionId: string;
    };

    /** LLM service sent a streaming chunk */
    'llmservice:chunk': {
        content: string;
        isComplete?: boolean;
        sessionId: string;
    };

    /** LLM service final response */
    'llmservice:response': {
        content: string;
        tokenCount?: number;
        model?: string;
        sessionId: string;
    };

    /** LLM service requested a tool call */
    'llmservice:toolCall': {
        toolName: string;
        args: Record<string, any>;
        callId?: string;
        sessionId: string;
    };

    /** LLM service returned a tool result */
    'llmservice:toolResult': {
        toolName: string;
        result: any;
        callId?: string;
        success: boolean;
        sessionId: string;
    };

    /** LLM service error */
    'llmservice:error': {
        error: Error;
        context?: string;
        recoverable?: boolean;
        sessionId: string;
    };

    /** LLM service switched */
    'llmservice:switched': {
        newConfig: any; // LLMConfig type
        router?: string;
        historyRetained?: boolean;
        sessionId: string;
    };

    /** LLM service unsupported input */
    'llmservice:unsupportedInput': {
        errors: string[];
        provider: LLMProvider;
        model?: string;
        fileType?: string;
        details?: any;
        sessionId: string;
    };

    // Agent state manager events
    /** Fired when agent runtime state changes */
    'dexto:stateChanged': {
        field: string; // keyof AgentRuntimeState
        oldValue: any;
        newValue: any;
        sessionId?: string;
    };

    /** Fired when agent state is exported as config */
    'dexto:stateExported': {
        config: any; // AgentConfig type
        runtimeSettings: any;
    };

    /** Fired when agent state is reset to baseline */
    'dexto:stateReset': {
        toConfig: any; // AgentConfig type
    };

    /** Fired when session override is set */
    'dexto:sessionOverrideSet': {
        sessionId: string;
        override: any; // SessionOverride type
    };

    /** Fired when session override is cleared */
    'dexto:sessionOverrideCleared': {
        sessionId: string;
    };

    /** Fired when MCP server is added to runtime state */
    'dexto:mcpServerAdded': {
        serverName: string;
        config: any; // McpServerConfig type
    };

    /** Fired when MCP server is removed from runtime state */
    'dexto:mcpServerRemoved': {
        serverName: string;
    };

    /** Fired when MCP server is updated in runtime state */
    'dexto:mcpServerUpdated': {
        serverName: string;
        config: any; // McpServerConfig type
    };

    /** Fired when tool confirmation is requested */
    'dexto:toolConfirmationRequest': {
        toolName: string;
        args: Record<string, any>;
        description?: string;
        executionId: string;
        timestamp: Date;
        sessionId?: string;
    };

    /** Fired when tool confirmation response is received */
    'dexto:toolConfirmationResponse': {
        executionId: string;
        approved: boolean;
        rememberChoice?: boolean;
        sessionId?: string;
    };
}

/**
 * Session-level events - these occur within individual sessions without session context
 * (since they're already scoped to a session)
 */
export interface SessionEventMap {
    /** LLM service started thinking */
    'llmservice:thinking': void;

    /** LLM service sent a streaming chunk */
    'llmservice:chunk': {
        content: string;
        isComplete?: boolean;
    };

    /** LLM service final response */
    'llmservice:response': {
        content: string;
        tokenCount?: number;
        model?: string;
    };

    /** LLM service requested a tool call */
    'llmservice:toolCall': {
        toolName: string;
        args: Record<string, any>;
        callId?: string;
    };

    /** LLM service returned a tool result */
    'llmservice:toolResult': {
        toolName: string;
        result: any;
        callId?: string;
        success: boolean;
    };

    /** LLM service error */
    'llmservice:error': {
        error: Error;
        context?: string;
        recoverable?: boolean;
    };

    /** LLM service switched */
    'llmservice:switched': {
        newConfig: any; // LLMConfig type
        router?: string;
        historyRetained?: boolean;
    };

    /** LLM service unsupported input */
    'llmservice:unsupportedInput': {
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
 * Generic typed EventEmitter base class
 */
class BaseTypedEventEmitter<TEventMap extends Record<string, any>> extends EventEmitter {
    // Store listeners with their abort controllers for cleanup
    private _abortListeners = new WeakMap<AbortSignal, Set<{ event: any; listener: any }>>();

    // Method overloads for typed events
    override emit<K extends keyof TEventMap>(
        event: K,
        ...args: TEventMap[K] extends void ? [] : [TEventMap[K]]
    ): boolean;
    // Method overload for untyped events (compatibility)
    override emit(event: string | symbol, ...args: any[]): boolean;
    // Implementation
    override emit(event: any, ...args: any[]): boolean {
        return super.emit(event, ...args);
    }

    // Method overloads for typed events with AbortController support
    override on<K extends keyof TEventMap>(
        event: K,
        listener: TEventMap[K] extends void ? () => void : (payload: TEventMap[K]) => void,
        options?: { signal?: AbortSignal }
    ): this;
    // Method overload for untyped events (compatibility)
    override on(
        event: string | symbol,
        listener: (...args: any[]) => void,
        options?: { signal?: AbortSignal }
    ): this;
    // Implementation
    override on(event: any, listener: any, options?: { signal?: AbortSignal }): this {
        // If signal is already aborted, don't add the listener
        if (options?.signal?.aborted) {
            return this;
        }

        // Add the listener
        super.on(event, listener);

        // Set up abort handling if signal is provided
        if (options?.signal) {
            const signal = options.signal;

            // Track this listener for cleanup
            if (!this._abortListeners.has(signal)) {
                this._abortListeners.set(signal, new Set());
            }
            this._abortListeners.get(signal)!.add({ event, listener });

            // Set up abort handler
            const abortHandler = () => {
                this.off(event, listener);

                // Clean up tracking
                const listeners = this._abortListeners.get(signal);
                if (listeners) {
                    listeners.delete({ event, listener });
                    if (listeners.size === 0) {
                        this._abortListeners.delete(signal);
                    }
                }
            };

            signal.addEventListener('abort', abortHandler, { once: true });
        }

        return this;
    }

    // Method overloads for typed events with AbortController support
    override once<K extends keyof TEventMap>(
        event: K,
        listener: TEventMap[K] extends void ? () => void : (payload: TEventMap[K]) => void,
        options?: { signal?: AbortSignal }
    ): this;
    // Method overload for untyped events (compatibility)
    override once(
        event: string | symbol,
        listener: (...args: any[]) => void,
        options?: { signal?: AbortSignal }
    ): this;
    // Implementation
    override once(event: any, listener: any, options?: { signal?: AbortSignal }): this {
        // If signal is already aborted, don't add the listener
        if (options?.signal?.aborted) {
            return this;
        }

        // Create a wrapper that handles both once and abort cleanup
        const onceWrapper = (...args: any[]) => {
            // Clean up abort tracking before calling the original listener
            if (options?.signal) {
                const listeners = this._abortListeners.get(options.signal);
                if (listeners) {
                    listeners.delete({ event, listener: onceWrapper });
                    if (listeners.size === 0) {
                        this._abortListeners.delete(options.signal);
                    }
                }
            }
            listener(...args);
        };

        // Add the wrapped listener
        super.once(event, onceWrapper);

        // Set up abort handling if signal is provided
        if (options?.signal) {
            const signal = options.signal;

            // Track this listener for cleanup
            if (!this._abortListeners.has(signal)) {
                this._abortListeners.set(signal, new Set());
            }
            this._abortListeners.get(signal)!.add({ event, listener: onceWrapper });

            // Set up abort handler
            const abortHandler = () => {
                this.off(event, onceWrapper);

                // Clean up tracking
                const listeners = this._abortListeners.get(signal);
                if (listeners) {
                    listeners.delete({ event, listener: onceWrapper });
                    if (listeners.size === 0) {
                        this._abortListeners.delete(signal);
                    }
                }
            };

            signal.addEventListener('abort', abortHandler, { once: true });
        }

        return this;
    }

    // Method overloads for typed events
    override off<K extends keyof TEventMap>(
        event: K,
        listener: TEventMap[K] extends void ? () => void : (payload: TEventMap[K]) => void
    ): this;
    // Method overload for untyped events (compatibility)
    override off(event: string | symbol, listener: (...args: any[]) => void): this;
    // Implementation
    override off(event: any, listener: any): this {
        return super.off(event, listener);
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
