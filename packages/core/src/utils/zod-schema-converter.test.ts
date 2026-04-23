import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getZodTypeFromProperty, jsonSchemaToZodShape } from './zod-schema-converter.js';

describe('zod-schema-converter', () => {
    it('preserves nullable JSON Schema types regardless of null position', () => {
        const stringOrNull = getZodTypeFromProperty({ type: ['string', 'null'] });
        const numberOrNull = getZodTypeFromProperty({ type: ['null', 'number'] });
        const stringNumberOrNull = getZodTypeFromProperty({ type: ['string', 'number', 'null'] });

        expect(stringOrNull.safeParse('hello').success).toBe(true);
        expect(stringOrNull.safeParse(null).success).toBe(true);
        expect(stringOrNull.safeParse(123).success).toBe(false);

        expect(numberOrNull.safeParse(42).success).toBe(true);
        expect(numberOrNull.safeParse(null).success).toBe(true);
        expect(numberOrNull.safeParse('nope').success).toBe(false);

        expect(stringNumberOrNull.safeParse('hello').success).toBe(true);
        expect(stringNumberOrNull.safeParse(42).success).toBe(true);
        expect(stringNumberOrNull.safeParse(null).success).toBe(true);
        expect(stringNumberOrNull.safeParse(false).success).toBe(false);
    });

    it('preserves nullable object properties and array items when building shapes', () => {
        const schema = z.object(
            jsonSchemaToZodShape({
                type: 'object',
                properties: {
                    name: {
                        type: ['string', 'null'],
                        description: 'Display name',
                    },
                    tags: {
                        type: 'array',
                        items: {
                            type: ['null', 'string'],
                        },
                    },
                },
                required: ['name', 'tags'],
            })
        );

        expect(
            schema.safeParse({
                name: null,
                tags: ['alpha', null],
            }).success
        ).toBe(true);
    });
});
