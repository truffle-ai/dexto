import type { HookManager } from '../manager.js';
import type { HookNotice } from '../types.js';

export interface ResponseSanitizerOptions {
    redactEmails?: boolean;
    redactApiKeys?: boolean;
    maxResponseLength?: number;
}

const DEFAULTS: Required<ResponseSanitizerOptions> = {
    redactEmails: false,
    redactApiKeys: false,
    maxResponseLength: 0,
};

/**
 * Response sanitizer builtin hook - Example hook that demonstrates beforeResponse usage
 *
 * This hook redacts sensitive information from LLM responses to prevent accidental leakage:
 * - Email addresses
 * - API keys and tokens
 * - Optional: Truncates responses that exceed length limits
 *
 * This is a practical example showing how hooks can modify response content before it's
 * sent to users, demonstrating the power of the beforeResponse hook point.
 */
export function registerResponseSanitizerBuiltin(
    hookManager: HookManager,
    opts?: ResponseSanitizerOptions
) {
    const redactEmails = opts?.redactEmails ?? DEFAULTS.redactEmails;
    const redactApiKeys = opts?.redactApiKeys ?? DEFAULTS.redactApiKeys;
    const maxResponseLength = opts?.maxResponseLength ?? DEFAULTS.maxResponseLength;

    hookManager.use(
        'beforeResponse',
        ({ content }) => {
            const notices: HookNotice[] = [];
            let modified = content;

            // Redact email addresses
            if (redactEmails) {
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
            if (redactApiKeys) {
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
            if (maxResponseLength > 0 && modified.length > maxResponseLength) {
                const originalLength = modified.length;
                const suffix = '... [truncated]';

                if (maxResponseLength <= suffix.length) {
                    // If maxResponseLength is too small, use truncated suffix
                    modified = suffix.slice(0, maxResponseLength);
                } else {
                    // Calculate adjusted length to account for suffix
                    const adjustedLength = maxResponseLength - suffix.length;
                    modified = modified.slice(0, adjustedLength) + suffix;
                }

                notices.push({
                    kind: 'warn',
                    code: 'response_sanitizer.truncated',
                    message: `Response truncated to ${maxResponseLength} characters.`,
                    details: { originalLength },
                });
            }

            // Return modifications if any were made
            if (modified !== content || notices.length > 0) {
                return {
                    modify: { content: modified },
                    ...(notices.length > 0 && { notices }),
                };
            }

            return;
        },
        { priority: 5 } // Lower priority than most hooks so it runs after other modifications
    );
}
