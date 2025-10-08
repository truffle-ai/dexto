import { logger } from '../../logger/index.js';
import type { HookManager } from '../manager.js';
import type { BeforeResponsePayload, HookRunResult, HookNotice } from '../types.js';

/**
 * Response Hook Architecture Design Notes:
 *
 * Current Flow:
 * 1. LLM generates response (original content)
 * 2. Hooks run (e.g., PII redaction, content filtering)
 * 3. Processed/redacted content is stored in history
 * 4. Processed content is emitted to user
 *
 * Design Rationale:
 * - Storage receives PROCESSED responses to avoid persisting sensitive data (PII, credentials, etc.)
 * - User input is stored ORIGINAL for audit trails (to know what user actually said)
 * - This protects against LLMs accidentally generating sensitive information
 *
 * Known Limitations:
 * - Multi-iteration tool calling: Content during tool iterations is stored unprocessed
 *   because hooks run on the complete accumulated response, not per-iteration
 * - Streaming: Chunks are emitted before hooks run (see streaming bypass comments in service files)
 *
 * TODO: Design audit trail strategy
 * - Consider whether original LLM responses should be logged separately for debugging
 * - Evaluate if hooks should have different behavior for storage vs. display
 * - Determine scope of audit data: full history, metadata only, or configurable levels
 * - Consider compliance requirements for different deployment scenarios
 */

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
 * @param defaultOverrideMessage - Message to use if hook cancels response without providing override
 * @returns Modified payload and any notices from hooks
 */
export async function executeResponseHooks(
    hookManager: HookManager | undefined,
    payload: BeforeResponsePayload,
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
                    sessionId: payload.sessionId,
                    ...(notice.code && { code: notice.code }),
                    ...(notice.details && { details: notice.details }),
                });
            } else {
                logger.info(message, {
                    sessionId: payload.sessionId,
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
