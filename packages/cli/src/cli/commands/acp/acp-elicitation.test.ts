import { describe, expect, it } from 'vitest';
import { formSchema } from './acp-elicitation.js';

describe('formSchema', () => {
    it('keeps typed fields with their choices, titles and required list', () => {
        expect(
            formSchema({
                type: 'object',
                title: 'Order',
                properties: {
                    size: { type: 'string', enum: ['small', 'large'], title: 'Size' },
                    count: { type: 'number', minimum: 1 },
                    toppings: { type: 'array', items: { enum: ['cheese', 'olives'] } },
                },
                required: ['size'],
            })
        ).toEqual({
            type: 'object',
            title: 'Order',
            properties: {
                size: { type: 'string', enum: ['small', 'large'], title: 'Size' },
                count: { type: 'number', minimum: 1 },
                toppings: { type: 'array', items: { enum: ['cheese', 'olives'] } },
            },
            required: ['size'],
        });
    });

    it.each([
        ['a boolean schema field', { type: 'object', properties: { anything: true } }],
        ['a field without a type', { type: 'object', properties: { size: { enum: ['a'] } } }],
        ['no properties', { type: 'object' }],
        ['a non-object schema', { type: 'string' }],
    ])('cannot show %s', (_label, schema) => {
        expect(formSchema(schema)).toBeNull();
    });
});
