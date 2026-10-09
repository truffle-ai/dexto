import { createElement, createRef } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import {
    ApprovalPrompt,
    type ApprovalPromptHandle,
    type ApprovalRequest,
} from './ApprovalPrompt.js';
import type { Key } from '../hooks/useInputOrchestrator.js';

const key: Key = {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageUp: false,
    pageDown: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    meta: false,
    tab: false,
    backspace: false,
    delete: false,
    paste: false,
};

describe('ApprovalPrompt', () => {
    it('shows the remembered command scope and submits a session approval', async () => {
        const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 40, isTTY: false });
        let output = '';
        stdout.on('data', (chunk) => {
            output += String(chunk);
        });
        const ref = createRef<ApprovalPromptHandle>();
        const onApprove = vi.fn();
        const view = render(
            createElement(ApprovalPrompt, {
                ref,
                approval: {
                    approvalId: 'request',
                    type: 'tool_approval',
                    sessionId: 'a',
                    timestamp: new Date(),
                    metadata: {
                        toolName: 'bash_exec',
                        approvalKey: 'bash:git status *',
                        args: { command: 'git status --short' },
                    },
                },
                onApprove,
                onDeny: vi.fn(),
                onCancel: vi.fn(),
            }),
            {
                stdout: stdout as unknown as NodeJS.WriteStream,
                // Ink buffers dynamic frames in CI unless debug rendering is enabled.
                debug: true,
                patchConsole: false,
                exitOnCtrlC: false,
            }
        );
        try {
            await vi.waitFor(() => expect(output).toContain('Allow git status * for this session'));
            ref.current?.handleInput('', { ...key, downArrow: true });
            await new Promise((resolve) => setTimeout(resolve, 20));
            ref.current?.handleInput('', { ...key, return: true });
            expect(onApprove).toHaveBeenCalledWith({ rememberChoice: true });
        } finally {
            view.unmount();
            view.cleanup();
        }
    });

    it.each<Pick<ApprovalRequest, 'type' | 'autoApproval' | 'metadata'>>([
        { type: 'command_approval', metadata: { toolName: 'edit_file' } },
        {
            type: 'tool_approval',
            autoApproval: 'disallowed',
            metadata: { toolName: 'edit_file' },
        },
        {
            type: 'tool_approval',
            metadata: { toolName: 'edit_file', approvalKey: 'file:specific-path' },
        },
    ])('does not broaden restricted edit approvals: %j', async (request) => {
        const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 40, isTTY: false });
        let output = '';
        stdout.on('data', (chunk) => {
            output += String(chunk);
        });
        const ref = createRef<ApprovalPromptHandle>();
        const onApprove = vi.fn();
        const view = render(
            createElement(ApprovalPrompt, {
                ref,
                approval: {
                    ...request,
                    approvalId: 'restricted',
                    sessionId: 'a',
                    timestamp: new Date(),
                },
                onApprove,
                onDeny: vi.fn(),
                onCancel: vi.fn(),
            }),
            {
                stdout: stdout as unknown as NodeJS.WriteStream,
                debug: true,
                patchConsole: false,
                exitOnCtrlC: false,
            }
        );
        try {
            await vi.waitFor(() => expect(output).toContain('Allow once'));
            expect(output).not.toContain('Allow all edits for this session');
            ref.current?.handleInput('', { ...key, shift: true, tab: true });
            expect(onApprove).not.toHaveBeenCalled();
        } finally {
            view.unmount();
            view.cleanup();
        }
    });
});
