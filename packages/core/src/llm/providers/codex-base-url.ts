export type CodexAuthMode = 'auto' | 'apikey' | 'chatgpt';

const CODEX_BASE_URL_PROTOCOL = 'codex:';
const CODEX_AUTH_MODES: readonly CodexAuthMode[] = ['auto', 'apikey', 'chatgpt'];

function normalizeCodexAuthMode(value: string | undefined): CodexAuthMode | null {
    if (value === undefined) {
        return null;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized.length === 0) {
        return null;
    }

    if (CODEX_AUTH_MODES.includes(normalized as CodexAuthMode)) {
        return normalized as CodexAuthMode;
    }

    return null;
}

export function createCodexBaseURL(mode: CodexAuthMode = 'chatgpt'): string {
    return `codex://${mode}`;
}

export function parseCodexBaseURL(value: string | undefined): { authMode: CodexAuthMode } | null {
    if (!value) {
        return null;
    }

    try {
        const parsed = new URL(value);
        if (parsed.protocol !== CODEX_BASE_URL_PROTOCOL) {
            return null;
        }

        const hostValue = parsed.host;
        const pathValue = parsed.pathname.replace(/^\/+/, '');
        const hostMode = normalizeCodexAuthMode(hostValue);
        const pathMode = normalizeCodexAuthMode(pathValue);

        if (hostValue.length > 0 && pathValue.length > 0) {
            return null;
        }

        const authMode =
            hostMode ??
            pathMode ??
            (hostValue.length === 0 && pathValue.length === 0 ? 'auto' : null);

        if (!authMode) {
            return null;
        }

        return { authMode };
    } catch {
        return null;
    }
}

export function isCodexBaseURL(value: string | undefined): boolean {
    return parseCodexBaseURL(value) !== null;
}

export function getCodexAuthModeLabel(mode: CodexAuthMode): string {
    switch (mode) {
        case 'chatgpt':
            return 'ChatGPT';
        case 'apikey':
            return 'API key';
        default:
            return 'Auto';
    }
}

export function getCodexProviderDisplayName(mode: CodexAuthMode = 'auto'): string {
    if (mode === 'auto' || mode === 'chatgpt') {
        return 'ChatGPT Login';
    }

    return `ChatGPT Login (${getCodexAuthModeLabel(mode)})`;
}
