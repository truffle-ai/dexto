import { describe, it, expect } from 'vitest';
import {
    parseResourceReferences,
    expandMessageReferences,
    type ResourceReference,
} from './reference-parser.js';
import type { ResourceSet } from './types.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

describe('parseResourceReferences', () => {
    it('should parse reference at start of message', () => {
        const refs = parseResourceReferences('@myfile.txt is important');
        expect(refs).toHaveLength(1);
        expect(refs[0]).toMatchObject({
            originalRef: '@myfile.txt',
            type: 'name',
            identifier: 'myfile.txt',
        });
    });

    it('should parse reference with leading whitespace', () => {
        const refs = parseResourceReferences('Check @myfile.txt');
        expect(refs).toHaveLength(1);
        expect(refs[0]).toMatchObject({
            originalRef: '@myfile.txt',
            type: 'name',
            identifier: 'myfile.txt',
        });
    });

    it('should parse URI reference with brackets', () => {
        const refs = parseResourceReferences('Check @<file:///path/to/file.txt>');
        expect(refs).toHaveLength(1);
        expect(refs[0]).toMatchObject({
            originalRef: '@<file:///path/to/file.txt>',
            type: 'uri',
            identifier: 'file:///path/to/file.txt',
        });
    });

    it('should parse server-scoped reference', () => {
        const refs = parseResourceReferences('Check @filesystem:myfile.txt');
        expect(refs).toHaveLength(1);
        expect(refs[0]).toMatchObject({
            originalRef: '@filesystem:myfile.txt',
            type: 'server-scoped',
            serverName: 'filesystem',
            identifier: 'myfile.txt',
        });
    });

    it('should NOT parse @ in email addresses', () => {
        const refs = parseResourceReferences('Email me at user@example.com');
        expect(refs).toHaveLength(0);
    });

    it('should parse real references but skip email addresses', () => {
        const refs = parseResourceReferences('Check @myfile but email user@example.com');
        expect(refs).toHaveLength(1);
        expect(refs[0].identifier).toBe('myfile');
    });

    it('should handle multiple email addresses and references', () => {
        const refs = parseResourceReferences(
            'Contact user@example.com or admin@example.com for @support.txt'
        );
        expect(refs).toHaveLength(1);
        expect(refs[0].identifier).toBe('support.txt');
    });

    it('should NOT match @ without leading whitespace', () => {
        const refs = parseResourceReferences('user@example.com has @file.txt');
        expect(refs).toHaveLength(1);
        expect(refs[0].identifier).toBe('file.txt');
    });

    it('should parse multiple references with whitespace', () => {
        const refs = parseResourceReferences('Check @file1.txt and @file2.txt');
        expect(refs).toHaveLength(2);
        expect(refs[0].identifier).toBe('file1.txt');
        expect(refs[1].identifier).toBe('file2.txt');
    });

    it('should parse reference after newline', () => {
        const refs = parseResourceReferences('First line\n@myfile.txt');
        expect(refs).toHaveLength(1);
        expect(refs[0].identifier).toBe('myfile.txt');
    });

    it('should NOT parse @ in middle of word', () => {
        const refs = parseResourceReferences('test@something word @file.txt');
        expect(refs).toHaveLength(1);
        expect(refs[0].identifier).toBe('file.txt');
    });

    it('should handle @ at start with no space before', () => {
        const refs = parseResourceReferences('@start then more@text and @end');
        expect(refs).toHaveLength(2);
        expect(refs[0].identifier).toBe('start');
        expect(refs[1].identifier).toBe('end');
    });
});

describe('expandMessageReferences', () => {
    const mockResourceSet: ResourceSet = {
        'file:///test.txt': {
            uri: 'file:///test.txt',
            name: 'test.txt',
            description: 'Test file',
            source: 'internal',
        },
    };

    const mockResourceReader = async (uri: string): Promise<ReadResourceResult> => {
        if (uri === 'file:///test.txt') {
            return {
                contents: [
                    {
                        uri: 'file:///test.txt',
                        mimeType: 'text/plain',
                        text: 'File content here',
                    },
                ],
            };
        }
        throw new Error(`Resource not found: ${uri}`);
    };

    it('should expand resource reference', async () => {
        const result = await expandMessageReferences(
            'Check @test.txt for info',
            mockResourceSet,
            mockResourceReader
        );

        expect(result.expandedReferences).toHaveLength(1);
        expect(result.expandedMessage).toContain('File content here');
        expect(result.expandedMessage).toContain('test.txt');
    });

    it('should NOT treat email addresses as references', async () => {
        const result = await expandMessageReferences(
            'Email me at user@example.com',
            mockResourceSet,
            mockResourceReader
        );

        expect(result.expandedReferences).toHaveLength(0);
        expect(result.expandedMessage).toBe('Email me at user@example.com');
    });

    it('should handle mixed resource references and email addresses', async () => {
        const result = await expandMessageReferences(
            'Check @test.txt and email user@example.com',
            mockResourceSet,
            mockResourceReader
        );

        expect(result.expandedReferences).toHaveLength(1);
        expect(result.expandedMessage).toContain('File content here');
        expect(result.expandedMessage).toContain('user@example.com');
    });

    it('should preserve multiple email addresses', async () => {
        const result = await expandMessageReferences(
            'Contact user@example.com or admin@test.com',
            mockResourceSet,
            mockResourceReader
        );

        expect(result.expandedReferences).toHaveLength(0);
        expect(result.expandedMessage).toBe('Contact user@example.com or admin@test.com');
    });

    it('should preserve email addresses when resource expansion fails', async () => {
        const result = await expandMessageReferences(
            'Check @nonexistent.txt and email user@example.com',
            mockResourceSet,
            mockResourceReader
        );

        expect(result.expandedReferences).toHaveLength(0);
        expect(result.unresolvedReferences).toHaveLength(1);
        expect(result.expandedMessage).toContain('user@example.com');
    });

    it('should handle @ symbols in various contexts', async () => {
        const result = await expandMessageReferences(
            'Before @test.txt middle more@text after',
            mockResourceSet,
            mockResourceReader
        );

        expect(result.expandedReferences).toHaveLength(1);
        expect(result.expandedMessage).toContain('File content here');
        expect(result.expandedMessage).toContain('more@text');
    });

    it('should handle message with no references', async () => {
        const result = await expandMessageReferences(
            'Just email user@example.com',
            mockResourceSet,
            mockResourceReader
        );

        expect(result.expandedReferences).toHaveLength(0);
        expect(result.unresolvedReferences).toHaveLength(0);
        expect(result.expandedMessage).toBe('Just email user@example.com');
    });

    it('should handle @ at start and in middle of text', async () => {
        const result = await expandMessageReferences(
            '@test.txt and contact@email.com',
            mockResourceSet,
            mockResourceReader
        );

        expect(result.expandedReferences).toHaveLength(1);
        expect(result.expandedMessage).toContain('File content here');
        expect(result.expandedMessage).toContain('contact@email.com');
    });
});
