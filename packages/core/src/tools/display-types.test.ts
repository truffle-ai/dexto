import { describe, expect, it } from 'vitest';
import { isValidDisplayData } from './display-types.js';

describe('isValidDisplayData', () => {
    it('accepts complete structured display data', () => {
        expect(
            isValidDisplayData({
                type: 'diff',
                unified: '--- a/config.json\n+++ b/config.json',
                filename: 'config.json',
                additions: 1,
                deletions: 1,
            })
        ).toBe(true);
    });

    it('accepts the reusable result display variants with explicit fields', () => {
        expect(
            isValidDisplayData({
                type: 'text',
                title: null,
                text: 'The operation returned plain text',
            })
        ).toBe(true);
        expect(
            isValidDisplayData({
                type: 'status',
                title: 'Sync',
                status: 'success',
                message: 'The workspace is up to date',
            })
        ).toBe(true);
        expect(
            isValidDisplayData({
                type: 'record',
                title: null,
                fields: [{ label: 'status', value: 'ready' }],
            })
        ).toBe(true);
        expect(
            isValidDisplayData({
                type: 'collection',
                title: 'Files',
                items: ['README.md', 'package.json'],
            })
        ).toBe(true);
        expect(
            isValidDisplayData({
                type: 'process',
                title: null,
                processId: 'proc_123',
                command: 'pnpm test',
                state: 'succeeded',
                exitCode: 0,
                startedAt: '2026-08-17T00:00:00.000Z',
                finishedAt: '2026-08-17T00:00:01.000Z',
            })
        ).toBe(true);
    });

    it('rejects a display discriminator without the fields its renderer requires', () => {
        expect(isValidDisplayData({ type: 'diff' })).toBe(false);
        expect(isValidDisplayData({ type: 'shell', command: 'pnpm test' })).toBe(false);
        expect(isValidDisplayData({ type: 'file', path: 'config.json' })).toBe(false);
        expect(isValidDisplayData({ type: 'text', title: null })).toBe(false);
        expect(isValidDisplayData({ type: 'record', title: null, fields: [] })).toBe(true);
        expect(isValidDisplayData({ type: 'collection', title: null, items: [1] })).toBe(false);
        expect(isValidDisplayData({ type: 'process', title: null })).toBe(false);
    });

    it.each([
        {
            type: 'diff',
            unified: '',
            filename: 'config.json',
            additions: -1,
            deletions: 0,
        },
        {
            type: 'search',
            pattern: 'TODO',
            matches: [{ file: 'src/app.ts', line: 1.5, content: '// TODO' }],
            totalMatches: 1,
            truncated: false,
        },
        {
            type: 'search',
            pattern: 'TODO',
            matches: [],
            totalMatches: -1,
            truncated: false,
        },
        { type: 'file', path: 'config.json', operation: 'read', size: 1.5 },
        { type: 'file', path: 'config.json', operation: 'read', lineCount: -1 },
    ])('rejects negative and fractional count fields', (display) => {
        expect(isValidDisplayData(display)).toBe(false);
    });
});
