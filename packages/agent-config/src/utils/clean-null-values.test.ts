import { describe, expect, it } from 'vitest';
import { cleanNullValues } from './clean-null-values.js';

describe('cleanNullValues', () => {
    it.each(['__proto__', 'constructor', 'prototype'])('rejects nested %s', (key) => {
        const config = JSON.parse(`{"tools":[{"${key}":{"polluted":true}}]}`);
        expect(() => cleanNullValues(config)).toThrow('Forbidden configuration key');
        expect(Object.prototype).not.toHaveProperty('polluted');
    });
});
