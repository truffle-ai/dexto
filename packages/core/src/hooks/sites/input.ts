import type { HookManager } from '../manager.js';
import type { BeforeInputPayload } from '../types.js';

export async function runBeforeInput(
    hookManager: HookManager | undefined,
    payload: BeforeInputPayload
): Promise<{ payload: BeforeInputPayload; canceled: boolean; responseOverride?: string }> {
    if (!hookManager) {
        return { payload, canceled: false };
    }
    return hookManager.run('beforeInput', payload);
}
