import type { HookManager } from '../manager.js';

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
    const cfg = { ...DEFAULTS, ...(opts || {}) };

    hookManager.use(
        'beforeInput',
        ({ text }) => {
            if (containsAbusiveLanguage(text)) {
                return {
                    cancel: true,
                    responseOverride: 'Input violates content policy due to abusive language.',
                };
            }

            let modified = text;
            if (cfg.maxInputChars > 0 && modified.length > cfg.maxInputChars) {
                modified = modified.slice(0, cfg.maxInputChars);
            }
            if (cfg.redactEmails) {
                modified = modified.replace(
                    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
                    '[redacted-email]'
                );
            }
            if (cfg.redactApiKeys) {
                modified = modified.replace(
                    /(api_key|apikey|bearer)\s*[:=]?\s*([A-Za-z0-9_\-]{12,})/gi,
                    '$1 [redacted]'
                );
            }
            if (modified !== text) {
                return { modify: { text: modified } };
            }
            return;
        },
        { priority: 10 }
    );
}
