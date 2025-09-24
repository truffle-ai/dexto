import type { HookManager } from '../manager.js';
import type { AfterToolResultPayload, BeforeToolCallPayload } from '../types.js';

export async function runBeforeToolCall(
    hookManager: HookManager | undefined,
    payload: BeforeToolCallPayload
) {
    if (!hookManager) {
        return { payload, canceled: false } as const;
    }
    return hookManager.run('beforeToolCall', payload);
}

export async function runAfterToolResult(
    hookManager: HookManager | undefined,
    payload: AfterToolResultPayload
) {
    if (!hookManager) {
        return { payload, canceled: false } as const;
    }
    return hookManager.run('afterToolResult', payload);
}
