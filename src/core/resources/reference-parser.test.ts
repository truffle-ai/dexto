import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    parseResourceReferences,
    resolveResourceReferences,
    expandMessageReferences,
    formatResourceContent,
} from './reference-parser.js';
import type { ResourceSet } from './types.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

describe('Resource Reference Parser - Unit Tests', () => {
    const mockResources: ResourceSet = {
        'mcp--filesystem--file:///test1.txt': {
            uri: 'mcp--filesystem--file:///test1.txt',
            name: 'test1.txt',
            description: 'Test file 1',
            source: 'mcp',
            serverName: 'filesystem',
            mimeType: 'text/plain',
            metadata: {
                originalUri: 'file:///test1.txt',
                serverName: 'filesystem',
            },
        },
        'mcp--web-api--https://example.com/data.json': {
            uri: 'mcp--web-api--https://example.com/data.json',
            name: 'data.json',
            description: 'API data',
            source: 'mcp',
            serverName: 'web-api',
            mimeType: 'application/json',
            metadata: {
                originalUri: 'https://example.com/data.json',
                serverName: 'web-api',
            },
        },
        'custom--provider1--custom://resource': {
            uri: 'custom--provider1--custom://resource',
            name: 'custom-resource',
            description: 'Custom resource',
            source: 'custom',
            metadata: {
                originalUri: 'custom://resource',
                providerName: 'provider1',
            },
        },
    };

    const mockReadResourceResult: ReadResourceResult = {
        contents: [
            {
                uri: 'file:///test1.txt',
                mimeType: 'text/plain',
                text: 'This is test file content.',
            },
        ],
        _meta: {},
    };

    describe('parseResourceReferences', () => {
        it('should parse simple resource name references', () => {
            const message = 'Please read @test1.txt and analyze it';
            const refs = parseResourceReferences(message);

            expect(refs).toHaveLength(1);
            expect(refs[0]).toEqual({
                originalRef: '@test1.txt',
                type: 'name',
                identifier: 'test1.txt',
            });
        });

        it('should parse URI references with angle brackets', () => {
            const message = 'Please read @<mcp--filesystem--file:///test1.txt>';
            const refs = parseResourceReferences(message);

            expect(refs).toHaveLength(1);
            expect(refs[0]).toEqual({
                originalRef: '@<mcp--filesystem--file:///test1.txt>',
                type: 'uri',
                identifier: 'mcp--filesystem--file:///test1.txt',
            });
        });

        it('should parse server-scoped references', () => {
            const message = 'Load @filesystem:test1.txt and @web-api:data.json';
            const refs = parseResourceReferences(message);

            expect(refs).toHaveLength(2);
            expect(refs[0]).toEqual({
                originalRef: '@filesystem:test1.txt',
                type: 'server-scoped',
                serverName: 'filesystem',
                identifier: 'test1.txt',
            });
            expect(refs[1]).toEqual({
                originalRef: '@web-api:data.json',
                type: 'server-scoped',
                serverName: 'web-api',
                identifier: 'data.json',
            });
        });

        it('should parse mixed reference types in one message', () => {
            const message =
                'Compare @test1.txt with @<mcp--web-api--https://example.com/data.json> and @filesystem:test1.txt';
            const refs = parseResourceReferences(message);

            expect(refs).toHaveLength(3);
            expect(refs[0]?.type).toBe('name');
            expect(refs[1]?.type).toBe('uri');
            expect(refs[2]?.type).toBe('server-scoped');
        });

        it('should handle resources with complex paths', () => {
            const message = 'Read @my-folder/sub-folder/file_name.json';
            const refs = parseResourceReferences(message);

            expect(refs).toHaveLength(1);
            expect(refs[0]).toEqual({
                originalRef: '@my-folder/sub-folder/file_name.json',
                type: 'name',
                identifier: 'my-folder/sub-folder/file_name.json',
            });
        });

        it('should not match invalid patterns', () => {
            const message = 'Email me at john@example.com or visit @';
            const refs = parseResourceReferences(message);

            expect(refs).toHaveLength(0);
        });

        it('should handle @ at word boundaries correctly', () => {
            const message = 'Check @file.txt@domain.com and @file.txt';
            const refs = parseResourceReferences(message);

            expect(refs).toHaveLength(1);
            expect(refs[0]?.identifier).toBe('file.txt');
        });
    });

    describe('resolveResourceReferences', () => {
        it('should resolve URI references correctly', () => {
            const refs = [
                {
                    originalRef: '@<mcp--filesystem--file:///test1.txt>',
                    type: 'uri' as const,
                    identifier: 'mcp--filesystem--file:///test1.txt',
                },
            ];

            const resolved = resolveResourceReferences(refs, mockResources);

            expect(resolved[0]?.resourceUri).toBe('mcp--filesystem--file:///test1.txt');
        });

        it('should resolve name references with exact match', () => {
            const refs = [
                {
                    originalRef: '@test1.txt',
                    type: 'name' as const,
                    identifier: 'test1.txt',
                },
            ];

            const resolved = resolveResourceReferences(refs, mockResources);

            expect(resolved[0]?.resourceUri).toBe('mcp--filesystem--file:///test1.txt');
        });

        it('should resolve server-scoped references', () => {
            const refs = [
                {
                    originalRef: '@filesystem:test1.txt',
                    type: 'server-scoped' as const,
                    serverName: 'filesystem',
                    identifier: 'test1.txt',
                },
            ];

            const resolved = resolveResourceReferences(refs, mockResources);

            expect(resolved[0]?.resourceUri).toBe('mcp--filesystem--file:///test1.txt');
        });

        it('should handle fuzzy name matching', () => {
            const refs = [
                {
                    originalRef: '@data',
                    type: 'name' as const,
                    identifier: 'data',
                },
            ];

            const resolved = resolveResourceReferences(refs, mockResources);

            expect(resolved[0]?.resourceUri).toBe('mcp--web-api--https://example.com/data.json');
        });

        it('should leave unresolvable references without resourceUri', () => {
            const refs = [
                {
                    originalRef: '@nonexistent.txt',
                    type: 'name' as const,
                    identifier: 'nonexistent.txt',
                },
            ];

            const resolved = resolveResourceReferences(refs, mockResources);

            expect(resolved[0]?.resourceUri).toBeUndefined();
        });

        it('should prioritize exact matches over partial matches', () => {
            const resourcesWithConflict: ResourceSet = {
                ...mockResources,
                'exact-match': {
                    uri: 'exact-match',
                    name: 'test',
                    description: 'Exact match',
                    source: 'mcp',
                },
                'partial-match': {
                    uri: 'partial-match',
                    name: 'test-partial',
                    description: 'Partial match',
                    source: 'mcp',
                },
            };

            const refs = [
                {
                    originalRef: '@test',
                    type: 'name' as const,
                    identifier: 'test',
                },
            ];

            const resolved = resolveResourceReferences(refs, resourcesWithConflict);

            expect(resolved[0]?.resourceUri).toBe('exact-match');
        });
    });

    describe('formatResourceContent', () => {
        it('should format text content correctly', () => {
            const formatted = formatResourceContent(
                'mcp--filesystem--file:///test1.txt',
                'test1.txt',
                mockReadResourceResult
            );

            expect(formatted).toContain(
                '--- Content from resource: test1.txt (mcp--filesystem--file:///test1.txt) ---'
            );
            expect(formatted).toContain('This is test file content.');
            expect(formatted).toContain('--- End of resource content ---');
        });

        it('should handle binary content', () => {
            const binaryResult: ReadResourceResult = {
                contents: [
                    {
                        uri: 'binary://test.bin',
                        mimeType: 'application/octet-stream',
                        blob: 'SGVsbG8gV29ybGQ=', // "Hello World" in base64
                    },
                ],
                _meta: {},
            };

            const formatted = formatResourceContent('binary://test.bin', 'test.bin', binaryResult);

            expect(formatted).toContain('[Binary content: application/octet-stream, 16 bytes]');
        });

        it('should handle multiple content items', () => {
            const multiContent: ReadResourceResult = {
                contents: [
                    {
                        uri: 'multi://test1',
                        mimeType: 'text/plain',
                        text: 'First part',
                    },
                    {
                        uri: 'multi://test2',
                        mimeType: 'text/plain',
                        text: 'Second part',
                    },
                ],
                _meta: {},
            };

            const formatted = formatResourceContent('multi://test', 'multi.txt', multiContent);

            expect(formatted).toContain('First part');
            expect(formatted).toContain('Second part');
        });
    });

    describe('expandMessageReferences', () => {
        const mockResourceReader = vi.fn();

        beforeEach(() => {
            mockResourceReader.mockReset();
            mockResourceReader.mockResolvedValue(mockReadResourceResult);
        });

        it('should expand simple resource references', async () => {
            const message = 'Please analyze @test1.txt';

            const result = await expandMessageReferences(
                message,
                mockResources,
                mockResourceReader
            );

            expect(result.expandedReferences).toHaveLength(1);
            expect(result.unresolvedReferences).toHaveLength(0);
            expect(result.expandedMessage).toContain('This is test file content.');
            expect(mockResourceReader).toHaveBeenCalledWith('mcp--filesystem--file:///test1.txt');
        });

        it('should handle multiple references', async () => {
            const message = 'Compare @test1.txt with @data.json';

            const result = await expandMessageReferences(
                message,
                mockResources,
                mockResourceReader
            );

            expect(result.expandedReferences).toHaveLength(2);
            expect(mockResourceReader).toHaveBeenCalledTimes(2);
        });

        it('should handle unresolvable references', async () => {
            const message = 'Read @nonexistent.txt and @test1.txt';

            const result = await expandMessageReferences(
                message,
                mockResources,
                mockResourceReader
            );

            expect(result.expandedReferences).toHaveLength(1);
            expect(result.unresolvedReferences).toHaveLength(1);
            expect(result.unresolvedReferences[0]?.originalRef).toBe('@nonexistent.txt');
        });

        it('should handle resource read failures gracefully', async () => {
            const message = 'Read @test1.txt';
            mockResourceReader.mockRejectedValueOnce(new Error('Read failed'));

            const result = await expandMessageReferences(
                message,
                mockResources,
                mockResourceReader
            );

            expect(result.expandedReferences).toHaveLength(0);
            expect(result.unresolvedReferences).toHaveLength(1);
        });

        it('should preserve original message when no references found', async () => {
            const message = 'This is a normal message without references';

            const result = await expandMessageReferences(
                message,
                mockResources,
                mockResourceReader
            );

            expect(result.expandedMessage).toBe(message);
            expect(result.expandedReferences).toHaveLength(0);
            expect(result.unresolvedReferences).toHaveLength(0);
            expect(mockResourceReader).not.toHaveBeenCalled();
        });

        it('should replace references with formatted content', async () => {
            const message = 'Content: @test1.txt more text';

            const result = await expandMessageReferences(
                message,
                mockResources,
                mockResourceReader
            );

            expect(result.expandedMessage).not.toContain('@test1.txt');
            expect(result.expandedMessage).toContain('--- Content from resource:');
            expect(result.expandedMessage).toContain('more text');
        });
    });
});
