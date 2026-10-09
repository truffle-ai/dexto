import { createElement, createRef } from 'react';
import type { SetStateAction } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { PermissionsSelector, type PermissionsSelectorHandle } from './PermissionsSelector.js';
import { createInitialState } from '../../state/initialState.js';
import type { UIState } from '../../state/types.js';
import type { TuiAgentBackend } from '../../agent-backend.js';
import type { Key } from '../../hooks/useInputOrchestrator.js';

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

async function openPermissions() {
    const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 40, isTTY: false });
    let output = '';
    stdout.on('data', (chunk) => {
        output += String(chunk);
    });
    const agent = {
        getSessionApprovals: vi
            .fn()
            .mockResolvedValue([{ kind: 'action', value: 'bash:git status *' }]),
        revokeSessionApproval: vi.fn().mockResolvedValue(undefined),
        getEffectiveConfig: () => ({ permissions: { mode: 'manual' } }),
    } as unknown as TuiAgentBackend;
    const ref = createRef<PermissionsSelectorHandle>();
    let ui = createInitialState().ui;
    const onClose = vi.fn();
    const view = render(
        createElement(PermissionsSelector, {
            ref,
            agent,
            sessionId: 'a',
            ui,
            setUi: (update: SetStateAction<UIState>) => {
                ui = typeof update === 'function' ? update(ui) : update;
            },
            onClose,
        }),
        {
            stdout: stdout as unknown as NodeJS.WriteStream,
            debug: true,
            patchConsole: false,
            exitOnCtrlC: false,
        }
    );
    await vi.waitFor(() => expect(output).toContain('Revoke git status *'));
    return {
        agent,
        onClose,
        getUi: () => ui,
        getOutput: () => output,
        async press(pressed: Partial<Key>) {
            ref.current?.handleInput('', { ...key, ...pressed });
            await new Promise((resolve) => setTimeout(resolve, 20));
        },
        close() {
            view.unmount();
            view.cleanup();
        },
    };
}

describe('PermissionsSelector', () => {
    it('lets a user choose session auto-approval without changing saved grants', async () => {
        const screen = await openPermissions();
        try {
            await screen.press({ downArrow: true });
            await screen.press({ downArrow: true });
            await screen.press({ return: true });
            expect(screen.getUi().bypassPermissions).toBe(true);
            expect(screen.getUi().autoApproveEdits).toBe(false);
            expect(screen.onClose).toHaveBeenCalledOnce();
            expect(screen.agent.revokeSessionApproval).not.toHaveBeenCalled();
        } finally {
            screen.close();
        }
    });

    it('lets a user revoke a displayed grant and keeps the selector open', async () => {
        const screen = await openPermissions();
        try {
            for (let index = 0; index < 3; index++) await screen.press({ downArrow: true });
            await screen.press({ return: true });
            expect(screen.agent.revokeSessionApproval).toHaveBeenCalledWith('a', {
                kind: 'action',
                value: 'bash:git status *',
            });
            await vi.waitFor(() =>
                expect(screen.getOutput()).toContain('No remembered user grants.')
            );
            expect(screen.onClose).not.toHaveBeenCalled();
        } finally {
            screen.close();
        }
    });
});
