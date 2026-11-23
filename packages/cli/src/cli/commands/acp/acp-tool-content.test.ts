import { createPatch } from 'diff';
import { describe, expect, it } from 'vitest';
import { displayContent, toolKind } from './acp-tool-content.js';

describe('toolKind', () => {
    it.each([
        ['file-read', 'read'],
        ['file-edit', 'edit'],
        ['file-write', 'edit'],
        ['file-create', 'edit'],
        ['file-search', 'search'],
        ['code-search', 'search'],
        ['web-search', 'fetch'],
        ['http-request', 'fetch'],
        ['command', 'execute'],
        ['process', 'execute'],
        ['user-input', 'other'],
    ] as const)('maps the %s activity to %s', (category, kind) => {
        expect(
            toolKind({
                version: 1,
                activity: {
                    category,
                    label: { running: '', completed: '' },
                    summary: { verb: '', singular: '', plural: '' },
                },
            })
        ).toBe(kind);
    });

    it('is other without a presentation snapshot', () => {
        expect(toolKind(undefined)).toBe('other');
    });
});

describe('displayContent', () => {
    const before = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', ''];
    const after = ['one', 'TWO', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', ''];

    it('turns each hunk of a unified diff into an ACP diff for the file', () => {
        const unified = createPatch('/w/numbers.txt', before.join('\n'), after.join('\n'), '', '', {
            context: 1,
        });
        expect(
            displayContent({
                type: 'diff',
                unified,
                filename: '/w/numbers.txt',
                additions: 2,
                deletions: 1,
            })
        ).toEqual([
            { type: 'diff', path: '/w/numbers.txt', oldText: 'one\ntwo\nthree', newText: 'one\nTWO\nthree' },
            { type: 'diff', path: '/w/numbers.txt', oldText: 'nine', newText: 'nine\nten' },
        ]);
    });

    it('reports a new file with no old text', () => {
        const unified = createPatch('/w/new.txt', '', 'hello\n', '', '');
        expect(
            displayContent({
                type: 'diff',
                unified,
                filename: '/w/new.txt',
                additions: 1,
                deletions: 0,
            })
        ).toEqual([{ type: 'diff', path: '/w/new.txt', oldText: null, newText: 'hello' }]);
    });

    it('shows a command with its output and exit code', () => {
        expect(
            displayContent({
                type: 'shell',
                command: 'ls',
                exitCode: 1,
                duration: 3,
                stdout: 'a.txt\n',
                stderr: 'oops\n',
            })
        ).toEqual([
            {
                type: 'content',
                content: { type: 'text', text: '$ ls\na.txt\noops\nexit code 1' },
            },
        ]);
    });

    it('leaves other displays to the text result', () => {
        expect(
            displayContent({ type: 'file', path: '/w/a', operation: 'read' })
        ).toBeNull();
    });
});
