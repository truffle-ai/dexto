import type { McpServerConfig } from '@dexto/core';
import type { ServerRegistryEntry } from '@dexto/registry';

const PLACEHOLDER_EXACT_MATCHES = new Set([
    'placeholder',
    'your-api-key',
    'your_api_key',
    'enter-your-token',
    'xxx',
    '...',
    'todo',
]);

const PLACEHOLDER_SUBSTRINGS = [
    'your-',
    'your_',
    'your ',
    'enter-',
    'enter_',
    'enter ',
    'placeholder',
    'api_key',
    'api-key',
    'api key',
    'secret',
    'token',
    'password',
    'xxx',
    '...',
];

const PLACEHOLDER_PREFIX_PATTERNS = [/^your[\s_-]?/, /^enter[\s_-]?/];

export function hasEmptyOrPlaceholderValue(obj: Record<string, string>): boolean {
    return Object.values(obj).some((value) => {
        if (!value || value.trim() === '') {
            return true;
        }

        const normalized = value.trim().toLowerCase();

        if (PLACEHOLDER_EXACT_MATCHES.has(normalized)) {
            return true;
        }

        if (PLACEHOLDER_PREFIX_PATTERNS.some((pattern) => pattern.test(normalized))) {
            return true;
        }

        return PLACEHOLDER_SUBSTRINGS.some((token) => normalized.includes(token));
    });
}

export function buildConfigFromRegistryEntry(entry: ServerRegistryEntry): McpServerConfig {
    const baseTimeout = entry.config.timeout ?? 30000;

    switch (entry.config.type) {
        case 'stdio':
            return {
                type: 'stdio',
                command: entry.config.command ?? '',
                args: entry.config.args ?? [],
                env: entry.config.env ?? {},
                timeout: baseTimeout,
                connectionMode: 'lenient',
            };
        case 'sse':
            return {
                type: 'sse',
                url: entry.config.url ?? '',
                headers: entry.config.headers ?? {},
                timeout: baseTimeout,
                connectionMode: 'lenient',
            };
        case 'http':
        default:
            return {
                type: 'http',
                url: entry.config.url ?? '',
                headers: entry.config.headers ?? {},
                timeout: baseTimeout,
                connectionMode: 'lenient',
            };
    }
}
