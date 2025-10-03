import type { HookManager } from '../manager.js';
import type { AfterToolResultPayload, BeforeToolCallPayload, HookRunResult } from '../types.js';

export async function runBeforeToolCall(
    hookManager: HookManager | undefined,
    payload: BeforeToolCallPayload
): Promise<HookRunResult<BeforeToolCallPayload>> {
    if (!hookManager) {
        return { payload, canceled: false };
    }
    return hookManager.run('beforeToolCall', payload);
}

export async function runAfterToolResult(
    hookManager: HookManager | undefined,
    payload: AfterToolResultPayload
): Promise<HookRunResult<AfterToolResultPayload>> {
    if (!hookManager) {
        return { payload, canceled: false };
    }
    return hookManager.run('afterToolResult', payload);
}
