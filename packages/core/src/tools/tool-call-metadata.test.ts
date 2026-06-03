import { describe, expect, it } from 'vitest';
import { wrapToolParametersSchema } from './tool-call-metadata.js';

describe('wrapToolParametersSchema', () => {
    it('does not narrow a union property when only one branch has enum constraints', () => {
        const schema = wrapToolParametersSchema({
            anyOf: [
                {
                    type: 'object',
                    properties: {
                        format: { const: 'email' },
                    },
                },
                {
                    type: 'object',
                    properties: {
                        format: { type: 'string' },
                    },
                },
            ],
        });

        expect(schema.properties?.format).toEqual({});
        expect(schema.properties).toHaveProperty('__meta');
    });

    it('merges enum constraints when every union branch constrains the property', () => {
        const schema = wrapToolParametersSchema({
            anyOf: [
                {
                    type: 'object',
                    properties: {
                        format: { const: 'email' },
                    },
                },
                {
                    type: 'object',
                    properties: {
                        format: { enum: ['sms', 'email'] },
                    },
                },
            ],
        });

        expect(schema.properties?.format).toEqual({ enum: ['email', 'sms'] });
    });
});
