import type { HookManager } from '../manager.js';
import type { HookNotice } from '../types.js';

export interface ContentPolicyOptions {
    maxInputChars?: number;
    redactEmails?: boolean;
    redactApiKeys?: boolean;
}

const DEFAULTS: Required<ContentPolicyOptions> = {
    maxInputChars: 0,
    redactEmails: false,
    redactApiKeys: false,
};

const ABUSIVE_PATTERNS: RegExp[] = [
    /\b(?:fuck|shit|bitch|asshole|bastard|cunt|dick|fag|slut|whore|nigger|retard|motherfucker|cock|piss|twat|wank|prick|spastic|chink|gook|kike|spic|wetback|tranny|dyke|homo|queer|faggot|rape|rapist)\b/i,
];

function containsAbusiveLanguage(text: string): boolean {
    return ABUSIVE_PATTERNS.some((pattern) => pattern.test(text));
}

export function registerContentPolicyBuiltin(
    hookManager: HookManager,
    opts?: ContentPolicyOptions
) {
    const maxInputChars = opts?.maxInputChars ?? DEFAULTS.maxInputChars;
    const redactEmails = opts?.redactEmails ?? DEFAULTS.redactEmails;
    const redactApiKeys = opts?.redactApiKeys ?? DEFAULTS.redactApiKeys;

    hookManager.use(
        'beforeInput',
        ({ text }) => {
            const notices: HookNotice[] = [];

            if (containsAbusiveLanguage(text)) {
                const abusiveNotice: HookNotice = {
                    kind: 'block',
                    code: 'content_policy.abusive_language',
                    message: 'Input violates content policy due to abusive language.',
                };
                notices.push(abusiveNotice);
                return {
                    cancel: true,
                    responseOverride: abusiveNotice.message,
                    notices,
                };
            }

            let modified = text;

            if (maxInputChars > 0 && modified.length > maxInputChars) {
                modified = modified.slice(0, maxInputChars);
                notices.push({
                    kind: 'warn',
                    code: 'content_policy.truncated',
                    message: `Input truncated to ${maxInputChars} characters to meet policy limits.`,
                    details: { originalLength: text.length },
                });
            }

            if (redactEmails) {
                const replaced = modified.replace(
                    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
                    '[redacted-email]'
                );
                if (replaced !== modified) {
                    notices.push({
                        kind: 'info',
                        code: 'content_policy.redact_email',
                        message: 'Email addresses were redacted from the input.',
                    });
                    modified = replaced;
                }
            }

            if (redactApiKeys) {
                const replaced = modified.replace(
                    /(api_key|apikey|bearer)\s*[:=]?\s*([A-Za-z0-9_-]{12,})/gi,
                    '$1 [redacted]'
                );
                if (replaced !== modified) {
                    notices.push({
                        kind: 'info',
                        code: 'content_policy.redact_api_key',
                        message: 'Potential API keys were redacted from the input.',
                    });
                    modified = replaced;
                }
            }

            if (modified !== text || notices.length > 0) {
                return {
                    modify: { text: modified },
                    ...(notices.length > 0 && { notices }),
                };
            }

            return;
        },
        { priority: 10 }
    );
}
