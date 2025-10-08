import type { HookManager } from '../manager.js';
import type { BeforeLLMRequestPayload, HookRunResult } from '../types.js';

export async function runBeforeLLMRequest(
    hookManager: HookManager | undefined,
    payload: BeforeLLMRequestPayload
): Promise<HookRunResult<BeforeLLMRequestPayload>> {
    if (!hookManager) {
        return { payload, canceled: false };
    }
    return hookManager.run('beforeLLMRequest', payload);
}
