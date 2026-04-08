function toShortSingleLineText(value: string, maxLen: number): string {
    const singleLine = value.replace(/\s+/g, ' ').trim();
    if (singleLine.length <= maxLen) return singleLine;
    return `${singleLine.slice(0, maxLen)}…`;
}

function toWhitelistedOauthErrorText(payload: unknown): string | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const record = payload as Record<string, unknown>;

    const parts: string[] = [];
    function addField(key: string): void {
        const value = record[key];
        if (typeof value !== 'string') return;
        const trimmed = value.trim();
        if (!trimmed) return;
        parts.push(`${key}: ${toShortSingleLineText(trimmed, 200)}`);
    }

    addField('error');
    addField('error_description');
    addField('message');
    addField('status');
    addField('status_msg');

    return parts.length > 0 ? parts.join(', ') : null;
}

export async function formatOauthHttpError(response: Response): Promise<string> {
    const statusLine = `${response.status} ${response.statusText}`.trim();

    let text = '';
    try {
        text = await response.text();
    } catch {
        text = '';
    }

    if (!text.trim()) return statusLine;

    try {
        const payload = JSON.parse(text) as unknown;
        const details = toWhitelistedOauthErrorText(payload);
        if (details) return `${statusLine}: ${details}`;
    } catch {
        // ignore parse errors
    }

    return statusLine;
}
