import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderFrame } from '../../signal/harness.js';
import type { Message } from '../../state/types.js';
import {
    SignalAgentMessage,
    SignalNote,
    SignalToolMessage,
    SignalUserMessage,
} from './SignalMessage.js';

function message(overrides: Partial<Message>): Message {
    return {
        id: 'm',
        role: 'tool',
        content: '',
        timestamp: new Date(0),
        ...overrides,
    };
}

const TEXT_ONLY = { columns: 72, terminal: 'no-color' } as const;

describe('Signal transcript', () => {
    it('puts the user and the agent in the margin, and wraps the agent inside it', () => {
        const user = createElement(SignalUserMessage, { content: 'Fix the auth tests.' });
        expect(renderFrame(user, TEXT_ONLY)).toBe('\n YOU    Fix the auth tests.');

        const prose = 'word '.repeat(30).trim();
        const agent = createElement(SignalAgentMessage, {
            message: message({ role: 'assistant', content: prose }),
            showReasoning: true,
        });
        const lines = renderFrame(agent, TEXT_ONLY).split('\n').slice(1);
        expect(lines[0]?.startsWith(' AGENT  word')).toBe(true);
        expect(lines.length).toBe(3);
        for (const line of lines.slice(1)) expect(line.startsWith('        word')).toBe(true);
    });

    it('keeps the margin but drops the label on a continuation', () => {
        const agent = createElement(SignalAgentMessage, {
            message: message({ role: 'assistant', content: 'more', isContinuation: true }),
            showReasoning: true,
        });
        expect(renderFrame(agent, TEXT_ONLY)).toBe('        more');
    });

    it('draws a tool call as one row, and a failure with its reason', () => {
        const ok = createElement(SignalToolMessage, {
            message: message({
                content: 'Bash(make lint)',
                toolName: 'bash_exec',
                toolArgs: 'make lint',
                toolStatus: 'finished',
                toolDisplayData: {
                    type: 'shell',
                    command: 'make lint',
                    exitCode: 0,
                    duration: 4200,
                },
            }),
        });
        const okFrame = renderFrame(ok, TEXT_ONLY);
        expect(okFrame.split('\n')).toHaveLength(1);
        expect(okFrame).toMatch(/^ {8}▪ RUN {5}make lint +4\.2s$/);

        const failed = createElement(SignalToolMessage, {
            message: message({
                content: 'Read(a.ts)',
                toolName: 'read_file',
                toolArgs: 'a.ts',
                toolStatus: 'finished',
                isError: true,
                toolResult: 'ENOENT: a.ts',
            }),
        });
        const lines = renderFrame(failed, TEXT_ONLY).split('\n');
        expect(lines[0]).toMatch(/READ {4}a\.ts +FAIL$/);
        expect(lines[1]).toBe('        ┊ ENOENT: a.ts');
    });

    it('keeps a diff inside the terminal, under the margin', () => {
        const row = createElement(SignalToolMessage, {
            message: message({
                content: 'Edit(a.ts)',
                toolName: 'edit_file',
                toolArgs: 'a.ts',
                toolStatus: 'finished',
                toolDisplayData: {
                    type: 'diff',
                    unified: `@@ -1 +1 @@\n+${'x '.repeat(200)}`,
                    filename: 'a.ts',
                    additions: 1,
                    deletions: 0,
                },
            }),
        });
        const lines = renderFrame(row, { columns: 80, terminal: 'no-color' }).split('\n');
        // A row wider than the terminal would be clipped and lose text.
        expect(lines.join('').match(/x/g)).toHaveLength(200);
        for (const line of lines) expect(line.trimEnd().length).toBeLessThanOrEqual(80);
    });

    it('draws an error as a fault block with what to try next', () => {
        const fault = createElement(SignalNote, {
            message: message({
                role: 'system',
                systemKind: 'fault',
                content: 'Error: Rate limited\n\n💡 Switch model',
            }),
        });
        const lines = renderFrame(fault, TEXT_ONLY).split('\n').slice(1);
        expect(lines[0]).toBe('      ▌ FAULT Rate limited');
        expect(lines[1]).toBe('      ▌ next Switch model');
    });

    it('marks where the user stopped the run, and keeps other notes quiet', () => {
        const stopped = createElement(SignalNote, {
            message: message({ role: 'system', systemKind: 'stopped', content: 'x' }),
        });
        expect(renderFrame(stopped, TEXT_ONLY)).toMatch(/■ STOPPED by you at .* type what to do/);

        const note = createElement(SignalNote, {
            message: message({ role: 'system', content: 'Model switched' }),
        });
        expect(renderFrame(note, TEXT_ONLY)).toBe('        · Model switched');
    });
});
