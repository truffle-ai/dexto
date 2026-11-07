import { safeJson } from '@dexto/tui/signal-text';

/**
 * A value as JSON for stdout or stderr. DEL, C1, bidi and invisible characters in it are written
 * as `\uXXXX`, so a hostile string can't act on a terminal and the JSON still parses to the same
 * value.
 */
export function jsonResult(value: unknown): string {
    return `${safeJson(value, 2)}\n`;
}

export function jsonError(error: {
    code: string;
    message: string;
    fix?: string;
    api_code?: string;
    details?: unknown;
}): string {
    return jsonResult({ error });
}
