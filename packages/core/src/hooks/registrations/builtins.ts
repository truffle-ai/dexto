import type { HookManager } from '../manager.js';
import { registerContentPolicyBuiltin, type ContentPolicyOptions } from './content-policy.js';
import { registerNotificationBuiltin } from './notifications.js';
import {
    registerResponseSanitizerBuiltin,
    type ResponseSanitizerOptions,
} from './response-sanitizer.js';
import type { ValidatedAgentConfig } from '../../agent/schemas.js';

export function registerBuiltInHooks(args: {
    hookManager: HookManager;
    config: ValidatedAgentConfig;
}) {
    const cp = args.config.hooks?.contentPolicy;
    if (cp && typeof cp === 'object') {
        const normalized: ContentPolicyOptions = {
            ...(cp.maxInputChars !== undefined ? { maxInputChars: cp.maxInputChars } : {}),
            ...(cp.redactEmails !== undefined ? { redactEmails: cp.redactEmails } : {}),
            ...(cp.redactApiKeys !== undefined ? { redactApiKeys: cp.redactApiKeys } : {}),
        };
        registerContentPolicyBuiltin(args.hookManager, normalized);
    }

    const rs = args.config.hooks?.responseSanitizer;
    if (rs && typeof rs === 'object') {
        const normalized: ResponseSanitizerOptions = {
            ...(rs.redactEmails !== undefined ? { redactEmails: rs.redactEmails } : {}),
            ...(rs.redactApiKeys !== undefined ? { redactApiKeys: rs.redactApiKeys } : {}),
            ...(rs.maxResponseLength !== undefined
                ? { maxResponseLength: rs.maxResponseLength }
                : {}),
        };
        registerResponseSanitizerBuiltin(args.hookManager, normalized);
    }

    registerNotificationBuiltin(args.hookManager);
}
