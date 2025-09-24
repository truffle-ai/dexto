import type { HookManager } from '../manager.js';
import type { BeforeResponsePayload } from '../types.js';

export async function runBeforeResponse(
    hookManager: HookManager | undefined,
    payload: BeforeResponsePayload
) {
    if (!hookManager) {
        return { payload, canceled: false } as const;
    }
    return hookManager.run('beforeResponse', payload);
}
