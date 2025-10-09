import { describe, test, expect } from 'vitest';
import {
    flattenPromptResult,
    normalizePromptArgs,
    appendContext,
    expandPlaceholders,
} from './utils.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';

describe('flattenPromptResult', () => {
    test('should flatten text content from messages', () => {
        const result: GetPromptResult = {
            messages: [
                {
                    role: 'user',
                    content: { type: 'text', text: 'Hello world' },
                },
            ],
        };

        const flattened = flattenPromptResult(result);

        expect(flattened.text).toBe('Hello world');
        expect(flattened.resourceUris).toEqual([]);
    });

    test('should flatten multiple text parts with newline separation', () => {
        const result = {
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'First line' },
                        { type: 'text', text: 'Second line' },
                    ],
                },
            ],
        } as unknown as GetPromptResult;

        const flattened = flattenPromptResult(result);

        expect(flattened.text).toBe('First line\nSecond line');
        expect(flattened.resourceUris).toEqual([]);
    });

    test('should extract resource URIs and text from resource content', () => {
        const result = {
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Check this file' },
                        {
                            type: 'resource',
                            resource: {
                                uri: 'file:///path/to/file.txt',
                                text: 'File content here',
                            },
                        },
                    ],
                },
            ],
        } as unknown as GetPromptResult;

        const flattened = flattenPromptResult(result);

        expect(flattened.text).toBe(
            'Check this file\nFile content here\n\n@<file:///path/to/file.txt>'
        );
        expect(flattened.resourceUris).toEqual(['file:///path/to/file.txt']);
    });

    test('should deduplicate resource URIs', () => {
        const result = {
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'resource',
                            resource: {
                                uri: 'file:///same.txt',
                                text: 'Content 1',
                            },
                        },
                        {
                            type: 'resource',
                            resource: {
                                uri: 'file:///same.txt',
                                text: 'Content 2',
                            },
                        },
                    ],
                },
            ],
        } as unknown as GetPromptResult;

        const flattened = flattenPromptResult(result);

        expect(flattened.resourceUris).toEqual(['file:///same.txt']);
        // Should only appear once in reference section
        expect(flattened.text).toBe('Content 1\nContent 2\n\n@<file:///same.txt>');
    });

    test('should handle string content directly', () => {
        const result = {
            messages: [
                {
                    role: 'user',
                    content: 'Simple string content',
                },
            ],
        } as unknown as GetPromptResult;

        const flattened = flattenPromptResult(result);

        expect(flattened.text).toBe('Simple string content');
        expect(flattened.resourceUris).toEqual([]);
    });

    test('should handle array of mixed content types', () => {
        const result = {
            messages: [
                {
                    role: 'user',
                    content: [
                        'Direct string',
                        { type: 'text', text: 'Text object' },
                        {
                            type: 'resource',
                            resource: {
                                uri: 'mcp://server/resource',
                                text: 'Resource text',
                            },
                        },
                    ],
                },
            ],
        } as unknown as GetPromptResult;

        const flattened = flattenPromptResult(result);

        expect(flattened.text).toBe(
            'Direct string\nText object\nResource text\n\n@<mcp://server/resource>'
        );
        expect(flattened.resourceUris).toEqual(['mcp://server/resource']);
    });

    test('should handle resources without text', () => {
        const result = {
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Main content' },
                        {
                            type: 'resource',
                            resource: {
                                uri: 'blob:abc123',
                            },
                        },
                    ],
                },
            ],
        } as unknown as GetPromptResult;

        const flattened = flattenPromptResult(result);

        expect(flattened.text).toBe('Main content\n\n@<blob:abc123>');
        expect(flattened.resourceUris).toEqual(['blob:abc123']);
    });

    test('should ignore non-text content types (image, etc.)', () => {
        const result = {
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'Text content' },
                        { type: 'image', data: 'base64data' },
                    ],
                },
            ],
        } as unknown as GetPromptResult;

        const flattened = flattenPromptResult(result);

        expect(flattened.text).toBe('Text content');
        expect(flattened.resourceUris).toEqual([]);
    });

    test('should handle empty messages array', () => {
        const result: GetPromptResult = {
            messages: [],
        };

        const flattened = flattenPromptResult(result);

        expect(flattened.text).toBe('');
        expect(flattened.resourceUris).toEqual([]);
    });

    test('should handle multiple messages', () => {
        const result: GetPromptResult = {
            messages: [
                {
                    role: 'user',
                    content: { type: 'text', text: 'Message 1' },
                },
                {
                    role: 'assistant',
                    content: { type: 'text', text: 'Message 2' },
                },
            ],
        };

        const flattened = flattenPromptResult(result);

        expect(flattened.text).toBe('Message 1\nMessage 2');
    });

    test('should filter out empty text parts', () => {
        const result = {
            messages: [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: '' },
                        { type: 'text', text: 'Valid content' },
                        { type: 'text', text: '' },
                    ],
                },
            ],
        } as unknown as GetPromptResult;

        const flattened = flattenPromptResult(result);

        expect(flattened.text).toBe('Valid content');
    });

    test('should ignore resources with empty URIs', () => {
        const result = {
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'resource',
                            resource: {
                                uri: '',
                                text: 'Content without URI',
                            },
                        },
                        {
                            type: 'resource',
                            resource: {
                                uri: 'file:///valid.txt',
                                text: 'Valid resource',
                            },
                        },
                    ],
                },
            ],
        } as unknown as GetPromptResult;

        const flattened = flattenPromptResult(result);

        expect(flattened.text).toBe('Content without URI\nValid resource\n\n@<file:///valid.txt>');
        expect(flattened.resourceUris).toEqual(['file:///valid.txt']);
    });
});

describe('expandPlaceholders', () => {
    test('replaces $ARGUMENTS with all positional tokens', () => {
        const out = expandPlaceholders('Run: $ARGUMENTS', { _positional: ['a', 'b', 'c'] });
        expect(out).toBe('Run: a b c');
    });

    test('replaces $1..$3 with corresponding tokens and leaves missing empty', () => {
        const out = expandPlaceholders('A:$1 B:$2 C:$3 D:$4', { _positional: ['x', 'y'] });
        expect(out).toBe('A:x B:y C: D:');
    });

    test('respects $$ escape', () => {
        const out = expandPlaceholders('Price $$1 and token $1', { _positional: ['X'] });
        expect(out).toBe('Price $1 and token X');
    });
});

describe('normalizePromptArgs', () => {
    test('should convert all values to strings', () => {
        const input = {
            name: 'John',
            age: 30,
            active: true,
        };

        const result = normalizePromptArgs(input);

        expect(result.args).toEqual({
            name: 'John',
            age: '30',
            active: 'true',
        });
        expect(result.context).toBeUndefined();
    });

    test('should extract _context field separately', () => {
        const input = {
            query: 'search term',
            _context: 'Additional context here',
        };

        const result = normalizePromptArgs(input);

        expect(result.args).toEqual({
            query: 'search term',
        });
        expect(result.context).toBe('Additional context here');
    });

    test('should trim _context field', () => {
        const input = {
            _context: '  trimmed context  ',
        };

        const result = normalizePromptArgs(input);

        expect(result.context).toBe('trimmed context');
    });

    test('should ignore empty _context field', () => {
        const input = {
            query: 'test',
            _context: '   ',
        };

        const result = normalizePromptArgs(input);

        expect(result.args).toEqual({
            query: 'test',
        });
        expect(result.context).toBeUndefined();
    });

    test('should stringify objects and arrays', () => {
        const input = {
            config: { nested: true },
            tags: ['tag1', 'tag2'],
        };

        const result = normalizePromptArgs(input);

        expect(result.args).toEqual({
            config: '{"nested":true}',
            tags: '["tag1","tag2"]',
        });
    });

    test('should skip undefined and null values', () => {
        const input = {
            defined: 'value',
            undefinedKey: undefined,
            nullKey: null,
        };

        const result = normalizePromptArgs(input);

        expect(result.args).toEqual({
            defined: 'value',
        });
    });

    test('should handle empty input', () => {
        const result = normalizePromptArgs({});

        expect(result.args).toEqual({});
        expect(result.context).toBeUndefined();
    });

    test('should handle non-JSON-serializable values gracefully', () => {
        const circular: any = { name: 'obj' };
        circular.self = circular;

        const input = {
            regular: 'value',
            circular: circular,
        };

        const result = normalizePromptArgs(input);

        expect(result.args.regular).toBe('value');
        expect(result.args.circular).toBe('[object Object]'); // Falls back to String()
    });

    test('should preserve string values unchanged', () => {
        const input = {
            text: 'unchanged',
            number: '42',
        };

        const result = normalizePromptArgs(input);

        expect(result.args).toEqual({
            text: 'unchanged',
            number: '42',
        });
    });
});

describe('appendContext', () => {
    test('should append context with double newline separator', () => {
        const result = appendContext('Main text', 'Additional context');

        expect(result).toBe('Main text\n\nAdditional context');
    });

    test('should return text unchanged when context is undefined', () => {
        const result = appendContext('Main text', undefined);

        expect(result).toBe('Main text');
    });

    test('should return text unchanged when context is empty', () => {
        const result = appendContext('Main text', '');

        expect(result).toBe('Main text');
    });

    test('should return text unchanged when context is whitespace only', () => {
        const result = appendContext('Main text', '   ');

        expect(result).toBe('Main text');
    });

    test('should return context when text is empty', () => {
        const result = appendContext('', 'Context only');

        expect(result).toBe('Context only');
    });

    test('should return context when text is whitespace only', () => {
        const result = appendContext('  ', 'Context only');

        expect(result).toBe('Context only');
    });

    test('should handle both empty text and empty context', () => {
        const result = appendContext('', '');

        expect(result).toBe('');
    });

    test('should handle undefined text gracefully', () => {
        const result = appendContext(undefined as any, 'Context');

        expect(result).toBe('Context');
    });

    test('should preserve multiline text and context', () => {
        const text = 'Line 1\nLine 2';
        const context = 'Context line 1\nContext line 2';

        const result = appendContext(text, context);

        expect(result).toBe('Line 1\nLine 2\n\nContext line 1\nContext line 2');
    });
});
