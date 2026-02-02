/**
 * SignalBus
 *
 * Event emitter for routing orchestration signals.
 * Supports typed subscriptions and promise-based waiting.
 */

import { EventEmitter } from 'events';
import type { Signal, SignalType } from './types.js';

/**
 * Handler function for signal subscriptions
 */
export type SignalHandler<T extends Signal = Signal> = (signal: T) => void;

/**
 * Predicate function for filtering signals
 */
export type SignalPredicate = (signal: Signal) => boolean;

/**
 * SignalBus - Routes signals between orchestration components
 */
export class SignalBus {
    private emitter = new EventEmitter();

    constructor() {
        // Increase max listeners since we may have many waiters
        this.emitter.setMaxListeners(100);
    }

    /**
     * Emit a signal to all subscribers
     */
    emit(signal: Signal): void {
        // Emit to type-specific listeners
        this.emitter.emit(signal.type, signal);
        // Emit to catch-all listeners
        this.emitter.emit('*', signal);
    }

    /**
     * Subscribe to signals of a specific type
     * @returns Unsubscribe function
     */
    on<T extends SignalType>(
        type: T,
        handler: SignalHandler<Extract<Signal, { type: T }>>
    ): () => void {
        this.emitter.on(type, handler);
        return () => this.emitter.off(type, handler);
    }

    /**
     * Subscribe to all signals
     * @returns Unsubscribe function
     */
    onAny(handler: SignalHandler): () => void {
        this.emitter.on('*', handler);
        return () => this.emitter.off('*', handler);
    }

    /**
     * Subscribe to a signal type once
     */
    once<T extends SignalType>(
        type: T,
        handler: SignalHandler<Extract<Signal, { type: T }>>
    ): void {
        this.emitter.once(type, handler);
    }

    /**
     * Remove a specific handler
     */
    off<T extends SignalType>(type: T, handler: SignalHandler<Extract<Signal, { type: T }>>): void {
        this.emitter.off(type, handler);
    }

    /**
     * Wait for a signal matching the predicate
     * @param predicate Function to test signals
     * @param timeout Optional timeout in milliseconds
     * @returns Promise that resolves with the matching signal
     */
    waitFor(predicate: SignalPredicate, timeout?: number): Promise<Signal> {
        return new Promise((resolve, reject) => {
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            let unsubscribe: (() => void) | undefined;

            const cleanup = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                if (unsubscribe) {
                    unsubscribe();
                }
            };

            const handler = (signal: Signal) => {
                if (predicate(signal)) {
                    cleanup();
                    resolve(signal);
                }
            };

            unsubscribe = this.onAny(handler);

            if (timeout !== undefined && timeout > 0) {
                timeoutId = setTimeout(() => {
                    cleanup();
                    reject(new Error(`Signal wait timed out after ${timeout}ms`));
                }, timeout);
            }
        });
    }

    /**
     * Wait for a signal for a specific task
     */
    waitForTask(taskId: string, timeout?: number): Promise<Signal> {
        return this.waitFor(
            (signal) =>
                (signal.type === 'task:completed' ||
                    signal.type === 'task:failed' ||
                    signal.type === 'task:cancelled') &&
                signal.taskId === taskId,
            timeout
        );
    }

    /**
     * Wait for any of multiple tasks to complete
     */
    waitForAnyTask(taskIds: string[], timeout?: number): Promise<Signal> {
        if (taskIds.length === 0) {
            return Promise.reject(new Error('taskIds must not be empty'));
        }
        const taskIdSet = new Set(taskIds);
        return this.waitFor(
            (signal) =>
                (signal.type === 'task:completed' ||
                    signal.type === 'task:failed' ||
                    signal.type === 'task:cancelled') &&
                taskIdSet.has(signal.taskId),
            timeout
        );
    }

    /**
     * Wait for all tasks to complete
     * @returns Promise that resolves with all signals
     */
    async waitForAllTasks(taskIds: string[], timeout?: number): Promise<Signal[]> {
        if (taskIds.length === 0) {
            return [];
        }
        const remaining = new Set(taskIds);
        const signals: Signal[] = [];

        return new Promise((resolve, reject) => {
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            let unsubscribe: (() => void) | undefined;

            const cleanup = () => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                if (unsubscribe) {
                    unsubscribe();
                }
            };

            const handler = (signal: Signal) => {
                if (
                    (signal.type === 'task:completed' ||
                        signal.type === 'task:failed' ||
                        signal.type === 'task:cancelled') &&
                    remaining.has(signal.taskId)
                ) {
                    remaining.delete(signal.taskId);
                    signals.push(signal);

                    if (remaining.size === 0) {
                        cleanup();
                        resolve(signals);
                    }
                }
            };

            unsubscribe = this.onAny(handler);

            if (timeout !== undefined && timeout > 0) {
                timeoutId = setTimeout(() => {
                    cleanup();
                    reject(
                        new Error(
                            `Waiting for all tasks timed out after ${timeout}ms. ` +
                                `Remaining tasks: ${Array.from(remaining).join(', ')}`
                        )
                    );
                }, timeout);
            }
        });
    }

    /**
     * Remove all listeners
     */
    clear(): void {
        this.emitter.removeAllListeners();
    }
}
