import type {
    Hook,
    BeforeResponsePayload,
    HookExecutionContext,
    HookResult,
    HookNotice,
} from '../types.js';

export interface ResponseSanitizerConfig {
    redactEmails?: boolean;
    redactApiKeys?: boolean;
    maxResponseLength?: number;
}

const DEFAULTS: Required<ResponseSanitizerConfig> = {
    redactEmails: false,
    redactApiKeys: false,
    maxResponseLength: 0,
};

/**
 * Response sanitizer built-in hook.
 *
 * This hook redacts sensitive information from LLM responses to prevent accidental leakage:
 * - Email addresses
 * - API keys and tokens
 * - Optional: Truncates responses that exceed length limits
 */
export class ResponseSanitizerHook implements Hook {
    private redactEmails: boolean = DEFAULTS.redactEmails;
    private redactApiKeys: boolean = DEFAULTS.redactApiKeys;
    private maxResponseLength: number = DEFAULTS.maxResponseLength;

    async initialize(config: Record<string, unknown>): Promise<void> {
        const sanitizerConfig = config as Partial<ResponseSanitizerConfig>;
        this.redactEmails = sanitizerConfig.redactEmails ?? DEFAULTS.redactEmails;
        this.redactApiKeys = sanitizerConfig.redactApiKeys ?? DEFAULTS.redactApiKeys;
        this.maxResponseLength = sanitizerConfig.maxResponseLength ?? DEFAULTS.maxResponseLength;
    }

    async beforeResponse(
        payload: BeforeResponsePayload,
        _context: HookExecutionContext
    ): Promise<HookResult> {
        const notices: HookNotice[] = [];
        let modified = payload.content;

        // Redact email addresses
        if (this.redactEmails) {
            const replaced = modified.replace(
                /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
                '[redacted-email]'
            );
            if (replaced !== modified) {
                notices.push({
                    kind: 'info',
                    code: 'response_sanitizer.redact_email',
                    message: 'Email addresses were redacted from the response.',
                });
                modified = replaced;
            }
        }

        // Redact potential API keys and tokens
        if (this.redactApiKeys) {
            // Pattern matches common API key formats
            const replaced = modified.replace(
                /(api[_-]?key|apikey|token|bearer|secret)\s*[:=]?\s*['"]?([A-Za-z0-9_-]{12,})['"]?/gi,
                '$1 [redacted]'
            );
            if (replaced !== modified) {
                notices.push({
                    kind: 'info',
                    code: 'response_sanitizer.redact_api_key',
                    message: 'Potential API keys were redacted from the response.',
                });
                modified = replaced;
            }
        }

        // Truncate responses that exceed max length
        if (this.maxResponseLength > 0 && modified.length > this.maxResponseLength) {
            const originalLength = modified.length;
            const suffix = '... [truncated]';

            if (this.maxResponseLength <= suffix.length) {
                // If maxResponseLength is too small, use truncated suffix
                modified = suffix.slice(0, this.maxResponseLength);
            } else {
                // Calculate adjusted length to account for suffix
                const adjustedLength = this.maxResponseLength - suffix.length;
                modified = modified.slice(0, adjustedLength) + suffix;
            }

            notices.push({
                kind: 'warn',
                code: 'response_sanitizer.truncated',
                message: `Response truncated to ${this.maxResponseLength} characters.`,
                details: { originalLength },
            });
        }

        // Return modifications if any were made
        if (modified !== payload.content) {
            const result: HookResult = {
                ok: true,
                modify: { content: modified },
            };
            if (notices.length > 0) {
                result.notices = notices;
            }
            return result;
        }

        return { ok: true };
    }
}
