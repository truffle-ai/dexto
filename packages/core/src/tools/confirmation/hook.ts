import type { HookManager } from '../../hooks/manager.js';
import type { ToolConfirmationProvider, ToolExecutionDetails } from './types.js';

export function registerToolConfirmationHook(
    provider: ToolConfirmationProvider,
    hookManager: HookManager
): void {
    hookManager.use(
        'beforeToolCall',
        async ({ toolName, args, sessionId }) => {
            const details: ToolExecutionDetails = {
                toolName,
                args,
                ...(sessionId !== undefined && { sessionId }),
            };
            const approved = await provider.requestConfirmation(details);
            if (!approved) {
                return {
                    cancel: true,
                    responseOverride: `Tool '${toolName}' execution was denied by the operator.`,
                    notices: [
                        {
                            kind: 'block',
                            code: 'tool_confirmation.denied',
                            message: `Tool '${toolName}' execution request was denied.`,
                            ...(sessionId ? { details: { sessionId } } : {}),
                        },
                    ],
                };
            }
            return;
        },
        { priority: 1000 }
    );
}
