import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderFrame } from '../../signal/harness.js';
import type { Message } from '../../state/types.js';
import { SignalAgentMessage, SignalToolMessage, SignalUserMessage } from './SignalMessage.js';

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
});
