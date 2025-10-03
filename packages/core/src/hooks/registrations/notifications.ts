import type { HookManager } from '../manager.js';
import { logger } from '../../logger/index.js';

export function registerNotificationBuiltin(hookManager: HookManager) {
    hookManager.use(
        'beforeResponse',
        ({ content, sessionId, model }) => {
            logger.info(
                `🔔 Response completed for session ${sessionId} (${model ?? 'unknown model'}) with ${content.length} characters`
            );
        },
        { priority: -100 }
    );
}
