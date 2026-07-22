import type { JSONSchema7 } from 'json-schema';

import { stableFingerprint } from '../utils/stable-fingerprint.js';

/** Fingerprints the callable input/output contract independent of object key order. */
export function toolSchemaFingerprint(
    inputSchema: JSONSchema7,
    outputSchema?: JSONSchema7
): string {
    return stableFingerprint(
        canonicalJson({ inputSchema, ...(outputSchema === undefined ? {} : { outputSchema }) })
    );
}

function canonicalJson(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalJson(entry ?? null)).join(',')}]`;
    }
    if (typeof value === 'object') {
        const properties = Object.entries(value)
            .filter(([, entry]) => entry !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
        return `{${properties.join(',')}}`;
    }

    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
        throw new Error(`Tool schema contains a non-JSON ${typeof value} value.`);
    }
    return serialized;
}
