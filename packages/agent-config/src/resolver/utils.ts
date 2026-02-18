export type PlainObject = Record<string, unknown>;

export function isPlainObject(value: unknown): value is PlainObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isSchemaLike(value: unknown): boolean {
    return isPlainObject(value) && typeof (value as { parse?: unknown }).parse === 'function';
}
