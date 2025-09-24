import type { HookManager } from '../manager.js';
import { registerToolConfirmationHook } from '../../tools/confirmation/hook.js';
import type { ToolConfirmationProvider } from '../../tools/confirmation/types.js';
import { registerContentPolicyBuiltin } from './content-policy.js';
import type { ValidatedAgentConfig } from '../../agent/schemas.js';

export function registerBuiltInHooks(args: {
    hookManager: HookManager;
    toolConfirmationProvider: ToolConfirmationProvider;
    config: ValidatedAgentConfig;
}) {
    registerToolConfirmationHook(args.toolConfirmationProvider, args.hookManager);

    const cp = (args.config as any).hooks?.contentPolicy;
    if (cp && typeof cp === 'object') {
        registerContentPolicyBuiltin(args.hookManager, cp);
    }
}
