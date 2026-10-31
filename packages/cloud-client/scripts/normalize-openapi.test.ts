import { describe, expect, it } from 'vitest';
import { normalizeOpenApi } from './normalize-openapi.js';

const errorSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
        error: {
            type: 'object',
            properties: { code: { type: 'string' }, details: { $ref: '#/$defs/__schema0' } },
        },
    },
    $defs: {
        __schema0: {
            anyOf: [{ type: 'string' }, { type: 'array', items: { $ref: '#/$defs/__schema0' } }],
        },
    },
};

describe('normalizeOpenApi', () => {
    it("hoists each schema's local $defs into components, once per distinct def", () => {
        const document = {
            openapi: '3.1.0',
            paths: {
                '/v1/a': {
                    get: {
                        responses: {
                            400: {
                                content: {
                                    'application/json': { schema: structuredClone(errorSchema) },
                                },
                            },
                        },
                    },
                },
                '/v1/b': {
                    get: {
                        responses: {
                            404: {
                                content: {
                                    'application/json': { schema: structuredClone(errorSchema) },
                                },
                            },
                        },
                    },
                },
            },
        };

        const normalized = normalizeOpenApi(document);

        const schemas = normalized.components.schemas;
        expect(Object.keys(schemas)).toHaveLength(1);
        const [name] = Object.keys(schemas);
        const ref = `#/components/schemas/${name}`;
        // A definition that refers to itself is any JSON value; TypeScript reads it as unknown.
        expect(schemas[name ?? '']).toEqual({ description: 'Any JSON value.' });
        const a = normalized.paths['/v1/a'].get.responses[400].content['application/json'].schema;
        expect(a).toEqual({
            type: 'object',
            properties: {
                error: {
                    type: 'object',
                    properties: { code: { type: 'string' }, details: { $ref: ref } },
                },
            },
        });
    });

    it('keeps components it was given and leaves documents without local defs alone', () => {
        const document = {
            openapi: '3.1.0',
            paths: { '/v1/c': { get: { responses: { 200: { description: 'ok' } } } } },
            components: {
                schemas: { Existing: { type: 'string' } },
                securitySchemes: { bearerAuth: { type: 'http' } },
            },
        };

        expect(normalizeOpenApi(document)).toEqual(document);
    });
});
