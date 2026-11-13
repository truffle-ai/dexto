import { describe, expect, it } from 'vitest';
import type { InternalMessage } from '@dexto/core';
import { convertHistoryToUIMessages, formatToolHeader } from './messageFormatting.js';
import { toolOutput, toolStep } from './tool-step.js';

describe('formatToolHeader fallback args', () => {
    it('truncates from the start (not mid-string)', () => {
        const long =
            'with base path set to packages/server (or absolute if needed). ' +
            'Summarize key directories and notable config/source files.';

        const { header } = formatToolHeader({
            toolName: 'spawn_agent',
            args: {
                instructions: long + ' '.repeat(10) + 'X'.repeat(500),
            },
        });

        expect(header).toContain('instructions=with base path set to packages/server');
        expect(header).toContain('...');
    });
});

describe('convertHistoryToUIMessages for a background command read back', () => {
    function resumed(text: string) {
        const history = [
            {
                role: 'tool',
                name: 'bash_output',
                toolCallId: 'c1',
                success: true,
                content: [{ type: 'text', text }],
                timestamp: 1,
            },
        ] as unknown as InternalMessage[];
        const message = convertHistoryToUIMessages(history, 's1')[0];
        if (message === undefined) throw new Error('expected a tool message');
        return message;
    }

    it('shows a failed command as failed, with its output', () => {
        const message = resumed(
            JSON.stringify({ status: 'failed', stderr: 'boom', stdout: '', exit_code: 2 })
        );
        expect(toolStep(message).state).toBe('fail');
        expect(toolOutput(message)).toEqual(['boom']);
    });

    it('leaves a completed command as it was', () => {
        const message = resumed(JSON.stringify({ status: 'completed', stdout: 'done' }));
        expect(toolStep(message).state).toBe('ok');
    });

    it('leaves a row as it was when the stored text cannot be parsed', () => {
        const message = resumed('{"status":"failed","stderr":"bo\n\n[Output truncated: ...]');
        expect(toolStep(message).state).toBe('ok');
        expect(message.toolOutcome).toBeUndefined();
    });
});
