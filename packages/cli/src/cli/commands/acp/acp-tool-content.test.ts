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
        ['skill-read', 'read'],
        ['history-search', 'search'],
        ['memory-delete', 'delete'],
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

    it.each(['constructor', '__proto__', 'toString'])(
        'is other for the inherited property name %s',
        (category) => {
            expect(
                toolKind({
                    version: 1,
                    activity: {
                        category,
                        label: { running: '', completed: '' },
                        summary: { verb: '', singular: '', plural: '' },
                    },
                })
            ).toBe('other');
        }
    );

    it('is other without a presentation snapshot', () => {
        expect(toolKind(undefined)).toBe('other');
    });
});

describe('displayContent', () => {
    const before = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', ''];
    const after = [
        'one',
        'TWO',
        'three',
        'four',
        'five',
        'six',
        'seven',
        'eight',
        'nine',
        'ten',
        '',
    ];

    it('turns each hunk of a unified diff into an ACP diff for the file', () => {
        const unified = createPatch('/w/numbers.txt', before.join('\n'), after.join('\n'), '', '', {
            context: 1,
        });
        expect(
            displayContent(
                {
                    type: 'diff',
                    unified,
                    filename: '/w/numbers.txt',
                    additions: 2,
                    deletions: 1,
                },
                '/w'
            )
        ).toEqual([
            {
                type: 'diff',
                path: '/w/numbers.txt',
                oldText: 'one\ntwo\nthree\n',
                newText: 'one\nTWO\nthree\n',
            },
            { type: 'diff', path: '/w/numbers.txt', oldText: 'nine\n', newText: 'nine\nten\n' },
        ]);
    });

    it('reports a new file with no old text, at its absolute path', () => {
        const unified = createPatch('new.txt', '', 'hello\n', '', '');
        expect(
            displayContent(
                {
                    type: 'diff',
                    unified,
                    filename: 'new.txt',
                    additions: 1,
                    deletions: 0,
                },
                '/w'
            )
        ).toEqual([{ type: 'diff', path: '/w/new.txt', oldText: null, newText: 'hello\n' }]);
    });

    it('shows a command with its output and exit code', () => {
        expect(
            displayContent(
                {
                    type: 'shell',
                    command: 'ls',
                    exitCode: 1,
                    duration: 3,
                    stdout: 'a.txt\n',
                    stderr: 'oops\n',
                },
                '/w'
            )
        ).toEqual([
            {
                type: 'content',
                content: { type: 'text', text: '$ ls\na.txt\noops\nexit code 1' },
            },
        ]);
    });

    it('drops the no-newline marker and carriage returns', () => {
        const unified = createPatch('crlf.txt', 'a\r\nb', 'a\r\nc', '', '');
        expect(
            displayContent(
                { type: 'diff', unified, filename: 'crlf.txt', additions: 1, deletions: 1 },
                '/w'
            )
        ).toEqual([{ type: 'diff', path: '/w/crlf.txt', oldText: 'a\nb', newText: 'a\nc' }]);
    });

    it('leaves a malformed patch to the text result', () => {
        const unified = '--- a\n+++ a\n@@ -1 +1 @@\n-a\n';
        expect(
            displayContent(
                { type: 'diff', unified, filename: 'a', additions: 0, deletions: 1 },
                '/w'
            )
        ).toBeNull();
    });

    it('shows a change that only adds the final newline', () => {
        const unified = createPatch('a.txt', 'a', 'a\n', '', '');
        expect(
            displayContent(
                { type: 'diff', unified, filename: 'a.txt', additions: 1, deletions: 1 },
                '/w'
            )
        ).toEqual([{ type: 'diff', path: '/w/a.txt', oldText: 'a', newText: 'a\n' }]);
    });

    it('leaves an unchanged file to the text result', () => {
        const unified = createPatch('same.txt', 'same\n', 'same\n', '', '');
        expect(
            displayContent(
                { type: 'diff', unified, filename: 'same.txt', additions: 0, deletions: 0 },
                '/w'
            )
        ).toBeNull();
    });

    it('leaves a command that has not finished to the text result', () => {
        // An approval preview, and a background start, carry no output and exit code 0.
        expect(
            displayContent(
                { type: 'shell', command: 'rm -rf build', exitCode: 0, duration: 0 },
                '/w'
            )
        ).toBeNull();
        expect(
            displayContent(
                {
                    type: 'shell',
                    command: 'npm start',
                    exitCode: 0,
                    duration: 0,
                    isBackground: true,
                },
                '/w'
            )
        ).toBeNull();
    });

    it('leaves other displays to the text result', () => {
        expect(displayContent({ type: 'file', path: '/w/a', operation: 'read' }, '/w')).toBeNull();
    });
});
