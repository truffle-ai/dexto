import { describe, expect, it } from 'vitest';
import type { JSONSchema7 } from 'json-schema';

import { toolSchemaFingerprint } from './schema-fingerprint.js';

describe('toolSchemaFingerprint', () => {
    it('is stable across object key order', () => {
        const first = {
            properties: { count: { type: 'number' }, query: { type: 'string' } },
            required: ['query'],
            type: 'object',
        } satisfies JSONSchema7;
        const reordered = {
            type: 'object',
            required: ['query'],
            properties: { query: { type: 'string' }, count: { type: 'number' } },
        } satisfies JSONSchema7;

        expect(toolSchemaFingerprint(first)).toBe(toolSchemaFingerprint(reordered));
        expect(toolSchemaFingerprint(first)).toMatch(/^[a-f0-9]{64}$/);
    });

    it('changes when either the input or output contract changes', () => {
        const input = {
            properties: { query: { type: 'string' } },
            type: 'object',
        } satisfies JSONSchema7;
        const output = {
            properties: { items: { type: 'array' } },
            type: 'object',
        } satisfies JSONSchema7;

        expect(toolSchemaFingerprint(input, output)).not.toBe(
            toolSchemaFingerprint(input, {
                properties: { items: { type: 'string' } },
                type: 'object',
            })
        );
        expect(toolSchemaFingerprint(input, output)).not.toBe(
            toolSchemaFingerprint(
                { properties: { query: { type: 'number' } }, type: 'object' },
                output
            )
        );
    });
});
