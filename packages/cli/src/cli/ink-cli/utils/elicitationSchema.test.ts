import { describe, it, expect } from 'vitest';
import { parseElicitationSchema } from './elicitationSchema.js';

describe('parseElicitationSchema', () => {
    it('uses a deterministic mapping for question/help/stepLabel', () => {
        const fields = parseElicitationSchema({
            type: 'object',
            properties: {
                allow_web_calls: {
                    type: 'boolean',
                    title: 'If false, I’ll skip live web tools and only test local repo tools.',
                    description: 'Allow web calls (web_search / code_search / http_request)',
                    'x-dexto': { stepLabel: 'Allow web calls' },
                },
                // boolean schema (valid JSON Schema) should be ignored by our UI form renderer
                ignored: true,
            },
            required: ['allow_web_calls'],
        });

        expect(fields).toHaveLength(1);
        expect(fields[0]).toMatchObject({
            name: 'allow_web_calls',
            stepLabel: 'Allow web calls',
            question: 'If false, I’ll skip live web tools and only test local repo tools.',
            helpText: 'Allow web calls (web_search / code_search / http_request)',
            type: 'boolean',
            required: true,
        });
    });

    it('falls back to a stable title-cased label when x-dexto.stepLabel is missing', () => {
        const fields = parseElicitationSchema({
            type: 'object',
            properties: {
                temp_file_path: {
                    type: 'string',
                },
            },
        });

        expect(fields).toHaveLength(1);
        expect(fields[0]?.stepLabel).toBe('Temp File Path');
        expect(fields[0]?.question).toBe('Temp File Path');
    });

    it('detects enum and array-enum field types', () => {
        const fields = parseElicitationSchema({
            type: 'object',
            properties: {
                color: {
                    enum: ['red', 'green'],
                },
                tags: {
                    type: 'array',
                    items: { enum: ['a', 'b'] },
                },
            },
        });

        expect(
            fields.map((f) => ({ name: f.name, type: f.type, enumValues: f.enumValues }))
        ).toEqual([
            { name: 'color', type: 'enum', enumValues: ['red', 'green'] },
            { name: 'tags', type: 'array-enum', enumValues: ['a', 'b'] },
        ]);
    });

    it('cleans x-dexto.stepLabel and filters non-string required entries', () => {
        const fields = parseElicitationSchema({
            type: 'object',
            properties: {
                allow: {
                    type: 'boolean',
                    'x-dexto': { stepLabel: '1) Allow web calls:' },
                },
            },
            required: ['allow', 123],
        });

        expect(fields).toHaveLength(1);
        expect(fields[0]?.stepLabel).toBe('Allow web calls');
        expect(fields[0]?.required).toBe(true);
    });
});
