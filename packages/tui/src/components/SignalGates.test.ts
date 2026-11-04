import { createElement, createRef } from 'react';
import { ApprovalType } from '@dexto/core';
import { describe, expect, it, vi } from 'vitest';
import { getCaps, setCaps } from '../signal/index.js';
import { renderFrame } from '../signal/harness.js';
import { render } from 'ink';
import { PassThrough } from 'node:stream';
import type { Key } from '../hooks/useInputOrchestrator.js';
import {
    ApprovalPrompt,
    approvalGateTitle,
    type ApprovalPromptHandle,
    type ApprovalRequest,
} from './ApprovalPrompt.js';

const TEXT_ONLY = { columns: 100, terminal: 'no-color' } as const;

function request(overrides: Partial<ApprovalRequest>): ApprovalRequest {
    return {
        approvalId: 'a1',
        type: ApprovalType.TOOL_APPROVAL,
        sessionId: 's1',
        timestamp: new Date(0),
        metadata: {},
        ...overrides,
    };
}

const SHELL = request({
    metadata: {
        toolName: 'bash_exec',
        args: { command: 'make migrate' },
        description: 'Applies the pending migration',
        displayPreview: { type: 'shell', command: 'make migrate', exitCode: 0, duration: 0 },
    },
});

function prompt(approval: ApprovalRequest) {
    return createElement(ApprovalPrompt, {
        approval,
        onApprove: () => {},
        onDeny: () => {},
        onCancel: () => {},
    });
}

const QUESTION = request({
    type: 'elicitation',
    metadata: {
        schema: {
            type: 'object',
            properties: {
                how_long: {
                    type: 'string',
                    enum: ['One release', 'Two releases'],
                    title: 'How long?',
                },
            },
            required: ['how_long'],
        },
        prompt: 'Pick one',
    },
});

describe('approvalGateTitle', () => {
    it.each([
        ['bash_exec', 'NEEDS YOU · RUN A COMMAND'],
        ['edit_file', 'NEEDS YOU · EDIT A FILE'],
        ['write_file', 'NEEDS YOU · WRITE A FILE'],
        ['plan_review', 'NEEDS YOU · REVIEW THE PLAN'],
        ['mcp--github--merge', 'NEEDS YOU · USE A TOOL'],
    ])('names %s', (toolName, title) => {
        expect(approvalGateTitle(ApprovalType.TOOL_APPROVAL, toolName)).toBe(title);
    });

    it('treats a command approval as a command, whatever the tool', () => {
        expect(approvalGateTitle(ApprovalType.COMMAND_APPROVAL, undefined)).toBe(
            'NEEDS YOU · RUN A COMMAND'
        );
    });
});

describe('Signal approval gate', () => {
    it('frames the command, why, and the keys to answer with', () => {
        const frame = renderFrame(prompt(SHELL), TEXT_ONLY);
        expect(frame).toContain('NEEDS YOU · RUN A COMMAND');
        expect(frame).toContain('$ make migrate');
        expect(frame).toContain('Applies the pending migration');
        expect(frame).toMatch(/› {2}y {2}Allow once/);
        expect(frame).toMatch(/ a {2}Allow .* for this session/);
        expect(frame).toMatch(/ n {2}Reject/);
    });

    it('answers on the option keys', () => {
        const saved = getCaps();
        setCaps({ ...saved, palette: 'signal' });
        const onApprove = vi.fn();
        const onDeny = vi.fn();
        const ref = createRef<ApprovalPromptHandle>();
        const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 40 });
        const view = render(
            createElement(ApprovalPrompt, {
                ref,
                approval: SHELL,
                onApprove,
                onDeny,
                onCancel: () => {},
            }),
            { stdout: stdout as unknown as NodeJS.WriteStream, debug: true, patchConsole: false }
        );
        const noKey = {} as Key;
        try {
            expect(ref.current?.handleInput('y', noKey)).toBe(true);
            expect(onApprove).toHaveBeenLastCalledWith({});
            expect(ref.current?.handleInput('a', noKey)).toBe(true);
            expect(onApprove).toHaveBeenLastCalledWith({ rememberChoice: true });
            expect(ref.current?.handleInput('n', noKey)).toBe(true);
            expect(onDeny).toHaveBeenCalledTimes(1);
            expect(ref.current?.handleInput('x', noKey)).toBe(false);
        } finally {
            view.unmount();
            setCaps(saved);
        }
    });

    it('asks a question inside the gate, with numbered options and no padding rows', () => {
        const frame = renderFrame(prompt(QUESTION), TEXT_ONLY);
        expect(frame).toContain('QUESTION · ');
        expect(frame).toMatch(/› 1 {2}One release/);
        expect(frame).toMatch(/ {2}2 {2}Two releases/);
        expect(frame).not.toMatch(/│ +│/);
    });

    it('marks the selected option without relying on colour', () => {
        const frame = renderFrame(prompt(SHELL), TEXT_ONLY);
        expect(frame.match(/›/g)).toHaveLength(1);
    });

    it('keeps long question help to two rows', () => {
        const help = 'word '.repeat(200).trim();
        const properties = {
            how_long: { type: 'string', enum: ['One'], title: 'How long?', description: help },
        };
        const metadata = { ...QUESTION.metadata, schema: { type: 'object', properties } };
        const frame = renderFrame(prompt({ ...QUESTION, metadata }), TEXT_ONLY);
        expect(frame.split('\n').filter((line) => line.includes('word')).length).toBeLessThan(3);
    });

    it('fits an edit preview inside the frame', () => {
        const unified = `@@ -1 +1 @@\n+${'x '.repeat(200)}`;
        const frame = renderFrame(
            prompt(
                request({
                    metadata: {
                        toolName: 'edit_file',
                        args: {},
                        displayPreview: {
                            type: 'diff',
                            unified,
                            filename: 'a.ts',
                            additions: 1,
                            deletions: 0,
                        },
                    },
                })
            ),
            TEXT_ONLY
        );
        for (const line of frame.split('\n')) {
            if (line.includes('x x')) expect(line.trimEnd().endsWith('│')).toBe(true);
        }
    });

    it('says a command will run in the background', () => {
        const preview = { type: 'shell', command: 'x', exitCode: 0, duration: 0 };
        const metadata = {
            toolName: 'bash_exec',
            args: {},
            displayPreview: { ...preview, isBackground: true },
        };
        expect(renderFrame(prompt(request({ metadata })), TEXT_ONLY)).toContain('(background)');
    });

    it('wraps question help to the width inside the gate, losing nothing mid-text', () => {
        const help = 'word '.repeat(20).trim();
        const properties = {
            how_long: { type: 'string', enum: ['One'], title: 'How long?', description: help },
        };
        const metadata = { ...QUESTION.metadata, schema: { type: 'object', properties } };
        const frame = renderFrame(prompt({ ...QUESTION, metadata }), {
            columns: 80,
            terminal: 'no-color',
        });
        const rows = frame.split('\n').filter((line) => line.includes('word'));
        expect(rows.join(' ').match(/word/g)).toHaveLength(20);
    });

    it('names the file an edit approval would change', () => {
        const metadata = {
            toolName: 'edit_file',
            args: {},
            displayPreview: {
                type: 'diff',
                unified: '@@ -1 +1 @@\n-a\n+b',
                filename: `${process.cwd()}/src/token.ts`,
                additions: 1,
                deletions: 1,
            },
        };
        expect(renderFrame(prompt(request({ metadata })), TEXT_ONLY)).toContain(
            'src/token.ts +1 −1'
        );
    });

    it('words a directory approval and keeps a wrapped option under its label', () => {
        const metadata = {
            toolName: 'edit_file',
            args: {},
            approvalKey: `directory:/tmp/${'long/'.repeat(14)}outside:operation:edit`,
        };
        const frame = renderFrame(prompt(request({ metadata })), {
            columns: 60,
            terminal: 'no-color',
        });
        expect(frame).not.toContain('directory:');
        expect(frame).not.toContain(':operation:');
        const label = frame.split('\n').findIndex((line) => line.includes('Allow edits in'));
        expect(label).toBeGreaterThan(-1);
        const start = (frame.split('\n')[label] ?? '').indexOf('Allow edits in');
        expect((frame.split('\n')[label + 1] ?? '').slice(0, start).replace(/[│ ]/g, '')).toBe('');
    });
});
