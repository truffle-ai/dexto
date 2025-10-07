import { logger } from '../../logger/index.js';
import type { HookManager } from '../manager.js';
import type { BeforeResponsePayload, HookRunResult, HookNotice } from '../types.js';

export async function runBeforeResponse(
    hookManager: HookManager | undefined,
    payload: BeforeResponsePayload
): Promise<HookRunResult<BeforeResponsePayload>> {
    if (!hookManager) {
        return { payload, canceled: false };
    }
    return hookManager.run('beforeResponse', payload);
}

export interface ProcessedHookResult {
    modifiedPayload: BeforeResponsePayload;
    notices?: HookNotice[];
}

/**
 * Executes beforeResponse hooks and processes the result with consistent logging and error handling.
 *
 * @param hookManager - The hook manager instance (optional)
 * @param payload - The response payload to process
 * @param sessionId - The session ID for logging context
 * @param defaultOverrideMessage - Message to use if hook cancels response without providing override
 * @returns Modified payload and any notices from hooks
 */
export async function executeResponseHooks(
    hookManager: HookManager | undefined,
    payload: BeforeResponsePayload,
    sessionId: string,
    defaultOverrideMessage = 'Response was blocked by a policy. Please try again.'
): Promise<ProcessedHookResult> {
    if (!hookManager) {
        return { modifiedPayload: payload };
    }

    const hookResult = await runBeforeResponse(hookManager, payload);

    // Process and log notices
    if (hookResult.notices && hookResult.notices.length > 0) {
        hookResult.notices.forEach((notice) => {
            const message = `Response hook notice (${notice.kind}) - ${notice.message}`;
            if (notice.kind === 'block' || notice.kind === 'warn') {
                logger.warn(message, {
                    sessionId,
                    ...(notice.code && { code: notice.code }),
                    ...(notice.details && { details: notice.details }),
                });
            } else {
                logger.info(message, {
                    sessionId,
                    ...(notice.code && { code: notice.code }),
                    ...(notice.details && { details: notice.details }),
                });
            }
        });
    }

    // Merge hook payload modifications with original
    const mergedPayload = {
        ...payload,
        ...(hookResult.payload ?? {}),
    };

    // Handle cancellation
    if (hookResult.canceled) {
        const overrideContent = hookResult.responseOverride || defaultOverrideMessage;
        const result: ProcessedHookResult = {
            modifiedPayload: { ...mergedPayload, content: overrideContent },
        };
        if (hookResult.notices && hookResult.notices.length > 0) {
            result.notices = hookResult.notices;
        }
        return result;
    }

    const result: ProcessedHookResult = {
        modifiedPayload: mergedPayload,
    };
    if (hookResult.notices && hookResult.notices.length > 0) {
        result.notices = hookResult.notices;
    }
    return result;
}
