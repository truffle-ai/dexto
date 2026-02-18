/**
 * Recursively removes `null` values from an object.
 *
 * This handles YAML files that have explicit `apiKey: null` entries which would otherwise
 * cause Zod validation errors like "Expected string, received null".
 */
export function cleanNullValues<T extends Record<string, unknown>>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
        return obj.map((item) =>
            typeof item === 'object' && item !== null
                ? cleanNullValues(item as Record<string, unknown>)
                : item
        ) as unknown as T;
    }

    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value === null) {
            continue;
        }
        if (typeof value === 'object' && !Array.isArray(value)) {
            cleaned[key] = cleanNullValues(value as Record<string, unknown>);
        } else if (Array.isArray(value)) {
            cleaned[key] = value.map((item) =>
                typeof item === 'object' && item !== null
                    ? cleanNullValues(item as Record<string, unknown>)
                    : item
            );
        } else {
            cleaned[key] = value;
        }
    }
    return cleaned as T;
}
