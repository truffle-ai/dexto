import type {
    Hook,
    HookResult,
    HookNotice,
    BeforeLLMRequestPayload,
    HookExecutionContext,
} from '../types.js';

/**
 * Configuration options for the ContentPolicy plugin
 */
export interface ContentPolicyConfig {
    maxInputChars?: number;
    redactEmails?: boolean;
    redactApiKeys?: boolean;
}

const DEFAULTS: Required<ContentPolicyConfig> = {
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

/**
 * ContentPolicy built-in hook.
 *
 * Enforces content policies on LLM requests including:
 * - Abusive language detection (blocking)
 * - Input length limits
 * - Email address redaction
 * - API key redaction
 */
export class ContentPolicyHook implements Hook {
    private config: Required<ContentPolicyConfig> = DEFAULTS;

    async initialize(config: Record<string, unknown>): Promise<void> {
        const pluginConfig = config as Partial<ContentPolicyConfig>;
        this.config = {
            maxInputChars: pluginConfig.maxInputChars ?? DEFAULTS.maxInputChars,
            redactEmails: pluginConfig.redactEmails ?? DEFAULTS.redactEmails,
            redactApiKeys: pluginConfig.redactApiKeys ?? DEFAULTS.redactApiKeys,
        };
    }

    async beforeLLMRequest(
        payload: BeforeLLMRequestPayload,
        _context: HookExecutionContext
    ): Promise<HookResult> {
        const notices: HookNotice[] = [];
        const { text } = payload;

        // Check for abusive language (blocking)
        if (containsAbusiveLanguage(text)) {
            const abusiveNotice: HookNotice = {
                kind: 'block',
                code: 'content_policy.abusive_language',
                message: 'Input violates content policy due to abusive language.',
            };
            notices.push(abusiveNotice);
            return {
                ok: false,
                cancel: true,
                message: abusiveNotice.message,
                notices,
            };
        }

        let modified = text;

        // Apply input length limit
        if (this.config.maxInputChars > 0 && modified.length > this.config.maxInputChars) {
            modified = modified.slice(0, this.config.maxInputChars);
            notices.push({
                kind: 'warn',
                code: 'content_policy.truncated',
                message: `Input truncated to ${this.config.maxInputChars} characters to meet policy limits.`,
                details: { originalLength: text.length },
            });
        }

        // Redact email addresses
        if (this.config.redactEmails) {
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

        // Redact API keys
        if (this.config.redactApiKeys) {
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

        // Return result with modifications if any
        if (modified !== text || notices.length > 0) {
            return {
                ok: true,
                modify: { text: modified },
                notices,
            };
        }

        // No changes needed
        return { ok: true };
    }
}
