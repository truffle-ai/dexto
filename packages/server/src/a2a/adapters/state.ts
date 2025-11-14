/**
 * A2A Task State Derivation
 *
 * Derives A2A task state from Dexto session state.
 * Tasks don't have their own state - state is computed from session history.
 */

import type { InternalMessage } from '@dexto/core';
import type { TaskState, Message } from '../types.js';

/**
 * Derive task state from session message history.
 *
 * Logic per A2A spec:
 * - submitted: Task has been submitted (no messages yet or only user message)
 * - working: Agent is processing the task
 * - completed: Task completed successfully (has complete exchange)
 * - failed: Session encountered an error (would need error tracking)
 * - canceled: Session was explicitly cancelled (would need cancellation tracking)
 *
 * Note: We derive from message patterns, not explicit state tracking.
 * This keeps tasks as pure views over sessions.
 *
 * @param messages Session message history
 * @returns Derived task state
 */
export function deriveTaskState(messages: InternalMessage[]): TaskState {
    // Empty session = submitted task
    if (messages.length === 0) {
        return 'submitted';
    }

    // Check for user and assistant messages
    const hasUserMessage = messages.some((m) => m.role === 'user');
    const hasAssistantMessage = messages.some((m) => m.role === 'assistant');

    // Complete exchange = completed task
    if (hasUserMessage && hasAssistantMessage) {
        return 'completed';
    }

    // User message without response = working task
    if (hasUserMessage && !hasAssistantMessage) {
        return 'working';
    }

    // Edge case: assistant message without user (shouldn't happen normally)
    return 'submitted';
}

/**
 * Derive task state from A2A messages (already converted).
 *
 * This is a convenience function when you already have A2A messages
 * and don't want to go back to internal format.
 *
 * @param messages A2A protocol messages
 * @returns Derived task state
 */
export function deriveTaskStateFromA2A(messages: Message[]): TaskState {
    if (messages.length === 0) {
        return 'submitted';
    }

    const hasUserMessage = messages.some((m) => m.role === 'user');
    const hasAgentMessage = messages.some((m) => m.role === 'agent');

    if (hasUserMessage && hasAgentMessage) {
        return 'completed';
    }

    if (hasUserMessage && !hasAgentMessage) {
        return 'working';
    }

    return 'submitted';
}
