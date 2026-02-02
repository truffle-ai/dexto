/**
 * ConditionEngine
 *
 * Evaluates wait conditions and resolves when met.
 * Supports single task, any/all of multiple tasks, timeouts, and races.
 */

import { randomUUID } from 'crypto';
import type { WaitCondition, Signal, WaitResult } from './types.js';
import type { SignalBus } from './signal-bus.js';
import type { TaskRegistry } from './task-registry.js';

/**
 * ConditionEngine - Evaluates composable wait conditions
 */
export class ConditionEngine {
    constructor(
        private taskRegistry: TaskRegistry,
        private signalBus: SignalBus
    ) {}

    /**
     * Wait for a condition to be met
     * @param condition Wait condition to evaluate
     * @returns Promise resolving to the signal(s) that satisfied the condition
     */
    async wait(condition: WaitCondition): Promise<WaitResult> {
        // First check if already satisfied
        const immediate = this.check(condition);
        if (immediate) {
            return immediate;
        }

        // Otherwise wait for the condition
        return this.evaluate(condition);
    }

    /**
     * Check if a condition is already satisfied (non-blocking)
     * @returns WaitResult if satisfied, null if not
     */
    check(condition: WaitCondition): WaitResult | null {
        switch (condition.type) {
            case 'task':
                return this.checkTask(condition.taskId);

            case 'any':
                return this.checkAny(condition.conditions);

            case 'all':
                return this.checkAll(condition.conditions);

            case 'timeout':
                // Timeout is never immediately satisfied
                return null;

            case 'race':
                // Check if task part is already satisfied
                return this.check(condition.task);
        }
    }

    /**
     * Check if a single task is completed
     */
    private checkTask(taskId: string): WaitResult | null {
        const result = this.taskRegistry.getResult(taskId);
        if (!result) {
            return null;
        }

        if (result.status === 'completed') {
            return {
                signal: {
                    type: 'task:completed',
                    taskId,
                    result: result.result,
                },
            };
        }

        if (result.status === 'failed') {
            return {
                signal: {
                    type: 'task:failed',
                    taskId,
                    error: result.error ?? 'Unknown error',
                },
            };
        }

        if (result.status === 'cancelled') {
            return {
                signal: {
                    type: 'task:cancelled',
                    taskId,
                },
            };
        }

        // Still running or pending
        return null;
    }

    /**
     * Check if any of the conditions is satisfied
     */
    private checkAny(conditions: WaitCondition[]): WaitResult | null {
        for (const condition of conditions) {
            const result = this.check(condition);
            if (result) {
                return result;
            }
        }
        return null;
    }

    /**
     * Check if all conditions are satisfied
     */
    private checkAll(conditions: WaitCondition[]): WaitResult | null {
        const signals: Signal[] = [];

        for (const condition of conditions) {
            const result = this.check(condition);
            if (!result) {
                return null; // Not all satisfied
            }
            signals.push(result.signal);
        }

        // All satisfied - signals array is guaranteed non-empty since we checked all conditions
        const primarySignal = signals[0];
        if (!primarySignal) {
            throw new Error('Internal error: no signals in checkAll result');
        }
        return {
            signal: primarySignal,
            allSignals: signals,
        };
    }

    /**
     * Evaluate a condition asynchronously
     */
    private async evaluate(condition: WaitCondition): Promise<WaitResult> {
        switch (condition.type) {
            case 'task':
                return this.evaluateTask(condition.taskId);

            case 'any':
                return this.evaluateAny(condition.conditions);

            case 'all':
                return this.evaluateAll(condition.conditions);

            case 'timeout':
                return this.evaluateTimeout(condition.ms, condition.conditionId);

            case 'race':
                return this.evaluateRace(condition.task, condition.timeout);
        }
    }

    /**
     * Wait for a single task to complete
     *
     * Uses subscribe-then-check pattern to avoid race conditions where
     * the task completes between checking and subscribing.
     */
    private async evaluateTask(taskId: string): Promise<WaitResult> {
        console.log(`[ConditionEngine] evaluateTask called for taskId=${taskId}`);
        return new Promise((resolve) => {
            let unsubscribe: (() => void) | undefined;

            const handler = (signal: Signal) => {
                console.log(
                    `[ConditionEngine] Received signal: type=${signal.type}, taskId=${'taskId' in signal ? signal.taskId : 'N/A'}`
                );
                if (
                    (signal.type === 'task:completed' ||
                        signal.type === 'task:failed' ||
                        signal.type === 'task:cancelled') &&
                    signal.taskId === taskId
                ) {
                    console.log(`[ConditionEngine] Signal matches taskId=${taskId}, resolving`);
                    if (unsubscribe) {
                        unsubscribe();
                    }
                    resolve({ signal });
                }
            };

            // Subscribe FIRST to avoid race condition
            unsubscribe = this.signalBus.onAny(handler);
            console.log(`[ConditionEngine] Subscribed to signals for taskId=${taskId}`);

            // THEN check if already done
            const immediate = this.checkTask(taskId);
            console.log(
                `[ConditionEngine] checkTask(${taskId}) returned: ${immediate ? 'found' : 'null'}`
            );
            if (immediate) {
                unsubscribe();
                resolve(immediate);
            }
            // If not done, the handler will resolve when signal arrives
        });
    }

    /**
     * Wait for any of the conditions to be satisfied
     */
    private async evaluateAny(conditions: WaitCondition[]): Promise<WaitResult> {
        // Check if any is already satisfied
        const immediate = this.checkAny(conditions);
        if (immediate) {
            return immediate;
        }

        // Race all conditions
        const promises = conditions.map((c) => this.evaluate(c));
        const result = await Promise.race(promises);

        // Note: Other pending conditions will continue running
        // They will complete but their results are ignored
        return result;
    }

    /**
     * Wait for all conditions to be satisfied
     */
    private async evaluateAll(conditions: WaitCondition[]): Promise<WaitResult> {
        // Check if all are already satisfied
        const immediate = this.checkAll(conditions);
        if (immediate) {
            return immediate;
        }

        // Wait for all conditions
        const results = await Promise.all(conditions.map((c) => this.evaluate(c)));
        const signals = results.map((r) => r.signal);

        // Guaranteed non-empty since conditions array is non-empty
        const primarySignal = signals[0];
        if (!primarySignal) {
            throw new Error('Internal error: no signals in evaluateAll result');
        }
        return {
            signal: primarySignal,
            allSignals: signals,
        };
    }

    /**
     * Wait for a timeout
     */
    private async evaluateTimeout(ms: number, conditionId: string): Promise<WaitResult> {
        await new Promise((resolve) => setTimeout(resolve, ms));

        const signal: Signal = {
            type: 'timeout',
            conditionId,
        };

        // Emit the timeout signal for any listeners
        this.signalBus.emit(signal);

        return { signal };
    }

    /**
     * Race a task condition against a timeout
     */
    private async evaluateRace(
        taskCondition: WaitCondition,
        timeoutCondition: WaitCondition
    ): Promise<WaitResult> {
        // First check if task is already done
        const immediate = this.check(taskCondition);
        if (immediate) {
            return immediate;
        }

        // Race task against timeout
        const result = await Promise.race([
            this.evaluate(taskCondition),
            this.evaluate(timeoutCondition),
        ]);

        return result;
    }

    /**
     * Helper to create a race condition with timeout
     */
    static createRaceWithTimeout(taskId: string, timeoutMs: number): WaitCondition {
        return {
            type: 'race',
            task: { type: 'task', taskId },
            timeout: {
                type: 'timeout',
                ms: timeoutMs,
                conditionId: `timeout-${randomUUID().slice(0, 8)}`,
            },
        };
    }

    /**
     * Helper to create an 'any' condition from task IDs
     */
    static createAnyTask(taskIds: string[]): WaitCondition {
        return {
            type: 'any',
            conditions: taskIds.map((taskId) => ({ type: 'task', taskId })),
        };
    }

    /**
     * Helper to create an 'all' condition from task IDs
     */
    static createAllTasks(taskIds: string[]): WaitCondition {
        return {
            type: 'all',
            conditions: taskIds.map((taskId) => ({ type: 'task', taskId })),
        };
    }
}
