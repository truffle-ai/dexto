export function jsonResult(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
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
