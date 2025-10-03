import type { HookManager } from '../manager.js';
import type { BeforeResponsePayload, HookRunResult } from '../types.js';

export async function runBeforeResponse(
    hookManager: HookManager | undefined,
    payload: BeforeResponsePayload
): Promise<HookRunResult<BeforeResponsePayload>> {
    if (!hookManager) {
        return { payload, canceled: false };
    }
    return hookManager.run('beforeResponse', payload);
}
