/**
 * AgentController
 *
 * Wraps DextoAgent and manages orchestration state.
 * Handles background task execution, state transitions, and context injection.
 */

import type { AgentState, Signal, TaskInfo } from './types.js';
import { SignalBus } from './signal-bus.js';
import { TaskRegistry, type TaskRegistryConfig } from './task-registry.js';
import { ConditionEngine } from './condition-engine.js';

type AgentLike = {
    generate: (content: string, sessionId?: string) => Promise<{ content: string }>;
    start: () => Promise<void>;
    stop: () => Promise<void>;
};

type LoggerLike = {
    debug: (message: string) => void;
    error?: (message: string) => void;
};

/**
 * Configuration for AgentController
 */
export interface AgentControllerConfig {
    /** The agent to wrap */
    agent: AgentLike;
    /** Optional logger instance */
    logger?: LoggerLike;
    /** Task registry configuration */
    taskRegistry?: TaskRegistryConfig;
    /** Session ID to use (defaults to a generated one) */
    sessionId?: string;
}

/**
 * AgentController - Orchestration wrapper for DextoAgent
 */
export class AgentController {
    private agent: AgentLike;
    private logger?: LoggerLike;
    private state: AgentState = 'idle';
    private sessionId: string;

    /** Signal bus for event routing */
    readonly signalBus: SignalBus;
    /** Task registry for tracking background tasks */
    readonly taskRegistry: TaskRegistry;
    /** Condition engine for evaluating wait conditions */
    readonly conditionEngine: ConditionEngine;

    /** Signals that arrived while agent was busy */
    private pendingSignals: Signal[] = [];

    /** Unsubscribe function for notify listener */
    private notifyUnsubscribe?: () => void;

    constructor(config: AgentControllerConfig) {
        this.agent = config.agent;
        if (config.logger) {
            this.logger = config.logger;
        }
        this.sessionId = config.sessionId ?? `session-${Date.now()}`;

        // Initialize orchestration components
        this.signalBus = new SignalBus();
        this.taskRegistry = new TaskRegistry(this.signalBus, config.taskRegistry);
        this.conditionEngine = new ConditionEngine(this.taskRegistry, this.signalBus, this.logger);

        // Set up listener for notify tasks
        this.setupNotifyListener();
    }

    /**
     * Set up listener for tasks with notify=true
     */
    private setupNotifyListener(): void {
        this.notifyUnsubscribe = this.signalBus.onAny((signal) => {
            if (
                signal.type === 'task:completed' ||
                signal.type === 'task:failed' ||
                signal.type === 'task:cancelled'
            ) {
                const entry = this.taskRegistry.get(signal.taskId);
                if (entry?.notify) {
                    if (this.state === 'idle') {
                        // Auto-trigger a turn for notify task
                        this.logger?.debug(`Auto-notify triggered for task ${signal.taskId}`);
                        void this.processNotify(signal).catch((error) => {
                            const message = error instanceof Error ? error.message : String(error);
                            this.logger?.error?.(
                                `AgentController.processNotify failed: ${message}`
                            );
                        });
                    } else {
                        this.pendingSignals.push(signal);
                    }
                }
            }
        });
    }

    /**
     * Process an auto-notify task completion
     */
    private async processNotify(signal: Signal): Promise<void> {
        if (this.state !== 'idle') {
            // Queue it for later
            this.pendingSignals.push(signal);
            return;
        }

        try {
            this.state = 'processing';

            // Build context about the completed task
            const taskInfo =
                signal.type === 'task:completed' || signal.type === 'task:failed'
                    ? this.taskRegistry.getInfo(signal.taskId)
                    : undefined;

            const contextMessage = this.buildNotifyContext(signal, taskInfo);

            // Generate agent response with the context
            await this.agent.generate(contextMessage, this.sessionId);

            // Acknowledge the notify
            if (taskInfo) {
                this.taskRegistry.acknowledgeNotify([taskInfo.taskId]);
            }
        } finally {
            this.state = 'idle';
            // Check for more pending signals
            this.processPendingSignals();
        }
    }

    /**
     * Build context message for auto-notify
     */
    private buildNotifyContext(signal: Signal, taskInfo?: TaskInfo): string {
        if (signal.type === 'task:completed' && taskInfo) {
            const resultStr =
                typeof taskInfo.result === 'string'
                    ? taskInfo.result
                    : JSON.stringify(taskInfo.result, null, 2);

            const durationLine =
                taskInfo.duration !== undefined ? `Duration: ${taskInfo.duration}ms\n` : '';

            return (
                `[Background Task Completed]\n` +
                `Task ID: ${taskInfo.taskId}\n` +
                `Type: ${taskInfo.type}\n` +
                `Description: ${taskInfo.description}\n` +
                durationLine +
                `Result:\n${resultStr}`
            );
        }

        if (signal.type === 'task:failed' && taskInfo) {
            return (
                `[Background Task Failed]\n` +
                `Task ID: ${taskInfo.taskId}\n` +
                `Type: ${taskInfo.type}\n` +
                `Description: ${taskInfo.description}\n` +
                `Error: ${taskInfo.error}`
            );
        }

        return `[Background Signal]\n${JSON.stringify(signal, null, 2)}`;
    }

    /**
     * Process any pending signals
     */
    private processPendingSignals(): void {
        while (this.pendingSignals.length > 0 && this.state === 'idle') {
            const signal = this.pendingSignals.shift();
            if (signal) {
                void this.processNotify(signal).catch((error) => {
                    const message = error instanceof Error ? error.message : String(error);
                    this.logger?.error?.(`AgentController.processNotify failed: ${message}`);
                });
            }
        }
    }

    /**
     * Process user input and generate response
     * @param content User message content
     * @returns Agent response
     */
    async process(content: string): Promise<string> {
        if (this.state !== 'idle') {
            throw new Error(`Cannot process while agent is ${this.state}`);
        }

        try {
            this.state = 'processing';

            // Inject task context if there are pending/completed tasks
            const { contextPrefix, notifyTaskIds } = this.buildTaskContext();
            const fullContent = contextPrefix ? `${contextPrefix}\n\n${content}` : content;

            // Generate response
            const response = await this.agent.generate(fullContent, this.sessionId);

            if (notifyTaskIds.length > 0) {
                this.taskRegistry.acknowledgeNotify(notifyTaskIds);
            }

            return response.content;
        } finally {
            this.state = 'idle';
            // Check for pending notify signals
            this.processPendingSignals();
        }
    }

    /**
     * Process a signal trigger (e.g., from external source)
     */
    async processSignal(signal: Signal): Promise<void> {
        if (this.state !== 'idle') {
            this.pendingSignals.push(signal);
            return;
        }

        await this.processNotify(signal);
    }

    /**
     * Build context about pending/completed tasks
     */
    private buildTaskContext(): { contextPrefix: string; notifyTaskIds: string[] } {
        const running = this.taskRegistry.list({ status: 'running' });
        const notifyPending = this.taskRegistry.getNotifyPending();

        if (running.length === 0 && notifyPending.length === 0) {
            return { contextPrefix: '', notifyTaskIds: [] };
        }

        const parts: string[] = [];

        if (running.length > 0) {
            parts.push(
                `[Background Tasks Running: ${running.length}]\n` +
                    running.map((t) => `- ${t.taskId}: ${t.description}`).join('\n')
            );
        }

        if (notifyPending.length > 0) {
            parts.push(
                `[Background Tasks Completed: ${notifyPending.length}]\n` +
                    notifyPending
                        .map((t) => {
                            const status = t.error ? `FAILED: ${t.error}` : 'SUCCESS';
                            return `- ${t.taskId}: ${t.description} [${status}]`;
                        })
                        .join('\n')
            );
        }

        return {
            contextPrefix: parts.join('\n\n'),
            notifyTaskIds: notifyPending.map((task) => task.taskId),
        };
    }

    /**
     * Get current agent state
     */
    getState(): AgentState {
        return this.state;
    }

    /**
     * Get the wrapped agent
     */
    getAgent(): AgentLike {
        return this.agent;
    }

    /**
     * Get session ID
     */
    getSessionId(): string {
        return this.sessionId;
    }

    /**
     * Inject a signal for processing
     */
    injectSignal(signal: Signal): void {
        this.signalBus.emit(signal);
    }

    /**
     * Clean up resources
     */
    cleanup(): void {
        if (this.notifyUnsubscribe) {
            this.notifyUnsubscribe();
        }
        this.pendingSignals = [];
        this.signalBus.clear();
        this.taskRegistry.clear();
    }

    /**
     * Start the agent (delegates to wrapped agent)
     */
    async start(): Promise<void> {
        await this.agent.start();
    }

    /**
     * Stop the agent (delegates to wrapped agent)
     */
    async stop(): Promise<void> {
        this.cleanup();
        await this.agent.stop();
    }
}
