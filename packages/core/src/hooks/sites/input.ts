import type { HookManager } from '../manager.js';
import type { BeforeInputPayload, HookRunResult } from '../types.js';

export async function runBeforeInput(
    hookManager: HookManager | undefined,
    payload: BeforeInputPayload
): Promise<HookRunResult<BeforeInputPayload>> {
    if (!hookManager) {
        return { payload, canceled: false };
    }
    return hookManager.run('beforeInput', payload);
}
