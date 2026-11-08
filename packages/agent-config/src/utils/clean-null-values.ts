import { assertSafeConfigKeys } from './assert-safe-config-keys.js';

/** Recursively removes null values from a configuration object. */
export function cleanNullValues<T extends Record<string, unknown>>(obj: T): T {
    assertSafeConfigKeys(obj);

    function clean(value: unknown): unknown {
        if (Array.isArray(value)) return value.map(clean);
        if (value === null || typeof value !== 'object') return value;
        const result: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
            if (child !== null) result[key] = clean(child);
        }
        return result;
    }

    return clean(obj) as T;
}
