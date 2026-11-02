import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderFrame } from '../../signal/harness.js';
import { parseUnifiedDiff } from './diff-shared.js';
import { SignalDiff, diffRows } from './SignalDiff.js';

const UNIFIED = [
    '--- a.ts',
    '+++ a.ts',
    '@@ -41,3 +41,3 @@ export function parse',
    ' keep',
    '-const old = 1;',
    '+const fresh = 1;',
    ' tail',
].join('\n');

describe('diffRows', () => {
    const rows = diffRows(parseUnifiedDiff(UNIFIED)[0]!);

    it('numbers each row on the side it exists on', () => {
        expect(rows.map((r) => [r.oldLine, r.newLine])).toEqual([
            [41, 41],
            [42, null],
            [null, 42],
            [43, 43],
        ]);
    });

    it('word-diffs a removed line against the added line after it', () => {
        expect(rows[1]?.parts?.some((p) => p.removed && p.value.includes('old'))).toBe(true);
        expect(rows[2]?.parts?.some((p) => p.added && p.value.includes('fresh'))).toBe(true);
        expect(rows[0]?.parts).toBeNull();
    });
});

describe('SignalDiff', () => {
    const data = {
        type: 'diff',
        unified: UNIFIED,
        filename: 'a.ts',
        additions: 1,
        deletions: 1,
    } as const;

    it('draws the hunk header, both line numbers and signs', () => {
        const frame = renderFrame(createElement(SignalDiff, { data, width: 60 }), {
            columns: 60,
            terminal: 'no-color',
        });
        const lines = frame.split('\n').map((l) => l.trimEnd());
        expect(lines[0]).toBe('┊ @@ −41,3 +41,3 @@ export function parse');
        expect(lines[1]).toBe('  41   41   keep');
        expect(lines[2]).toBe('  42      − const old = 1;');
        expect(lines[3]).toBe('       42 + const fresh = 1;');
    });

    it('wraps a long line so none of it is hidden', () => {
        const long = { ...data, unified: `@@ -1 +1 @@\n+${'x'.repeat(200)}` };
        const frame = renderFrame(createElement(SignalDiff, { data: long, width: 40 }), {
            columns: 40,
            terminal: 'no-color',
        });
        expect(frame.match(/x/g)).toHaveLength(200);
        for (const line of frame.split('\n')) expect(line.length).toBeLessThanOrEqual(40);
    });

    it('widens the gutter for large line numbers and keeps rows aligned', () => {
        const large = { ...data, unified: '@@ -100000,1 +100000,1 @@\n-old\n+new' };
        const lines = renderFrame(createElement(SignalDiff, { data: large, width: 60 }), {
            columns: 60,
            terminal: 'no-color',
        }).split('\n');
        expect(lines[1]?.trimEnd()).toBe('100000        − old');
        expect(lines[2]?.trimEnd()).toBe('       100000 + new');
    });

    it('falls back to plain signs on an ASCII terminal', () => {
        const frame = renderFrame(createElement(SignalDiff, { data, width: 60 }), {
            columns: 60,
            terminal: 'ascii',
        });
        expect(frame).not.toContain('┊');
        expect(frame).not.toContain('−');
    });
});
