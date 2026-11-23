import { describe, expect, it } from 'vitest';
import { formSchema } from './acp-elicitation.js';

describe('formSchema', () => {
    it('keeps the fields ACP shows, with their choices, titles and required list', () => {
        expect(
            formSchema({
                type: 'object',
                title: 'Order',
                properties: {
                    size: { type: 'string', enum: ['small', 'large'], title: 'Size' },
                    count: { type: 'number', minimum: 1 },
                    toppings: { type: 'array', items: { enum: ['cheese', 'olives'] } },
                    ok: { type: 'boolean', 'x-dexto': { stepLabel: 'OK' } },
                },
                required: ['size'],
            })
        ).toEqual({
            type: 'object',
            title: 'Order',
            properties: {
                size: { type: 'string', enum: ['small', 'large'], title: 'Size' },
                count: { type: 'number', minimum: 1 },
                toppings: { type: 'array', items: { type: 'string', enum: ['cheese', 'olives'] } },
                ok: { type: 'boolean' },
            },
            required: ['size'],
        });
    });

    it.each([
        ['a boolean schema field', { type: 'object', properties: { anything: true } }],
        ['a field without a type', { type: 'object', properties: { size: { enum: ['a'] } } }],
        ['no properties', { type: 'object' }],
        ['an object field', { type: 'object', properties: { a: { type: 'object' } } }],
        ['a list without items', { type: 'object', properties: { a: { type: 'array' } } }],
        [
            'a string format ACP lacks',
            { type: 'object', properties: { a: { type: 'string', format: 'uuid' } } },
        ],
        [
            'numeric choices',
            { type: 'object', properties: { a: { type: 'string', enum: [1, 2] } } },
        ],
        ['a non-object schema', { type: 'string' }],
    ])('cannot show %s', (_label, schema) => {
        expect(formSchema(schema)).toBeNull();
    });
});
