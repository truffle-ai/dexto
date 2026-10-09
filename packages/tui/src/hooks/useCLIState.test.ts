import { createElement } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { useCLIState, type CLIStateReturn } from './useCLIState.js';
import { KeypressProvider } from '../contexts/KeypressContext.js';
import type { TuiAgentBackend } from '../agent-backend.js';

const agent = {
    getCurrentLLMConfig: () => ({ provider: 'openai', model: 'gpt-5' }),
    getSessionHistory: async () => [],
    on: () => {},
} as unknown as TuiAgentBackend;

function mountState(initialSessionId: string | null) {
    const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 40, isTTY: false });
    let state: CLIStateReturn | undefined;
    function Probe() {
        state = useCLIState({
            agent,
            initialSessionId,
            initialBypassPermissions: true,
            startupInfo: {
                connectedServers: { count: 0, names: [] },
                failedConnections: [],
                toolCount: 0,
                logFile: null,
            },
        });
        return null;
    }
    const view = render(createElement(KeypressProvider, null, createElement(Probe)), {
        stdout: stdout as unknown as NodeJS.WriteStream,
        patchConsole: false,
        exitOnCtrlC: false,
    });
    return {
        getState() {
            if (!state) throw new Error('Not mounted');
            return state;
        },
        close() {
            view.unmount();
            view.cleanup();
        },
    };
}

describe('TUI session permission modes', () => {
    it('keeps startup auto-approval when the first session is created, then resets on switch', async () => {
        const screen = mountState(null);
        try {
            await vi.waitFor(() => expect(screen.getState().ui.bypassPermissions).toBe(true));
            screen
                .getState()
                .setSession((previous) => ({ ...previous, id: 'a', hasActiveSession: true }));
            await vi.waitFor(() => expect(screen.getState().session.id).toBe('a'));
            expect(screen.getState().ui.bypassPermissions).toBe(true);
            screen
                .getState()
                .setSession((previous) => ({ ...previous, id: 'b', hasActiveSession: true }));
            await vi.waitFor(() => expect(screen.getState().ui.bypassPermissions).toBe(false));
        } finally {
            screen.close();
        }
    });

    it('resets accept-edits mode when a conversation is cleared', async () => {
        const screen = mountState('a');
        try {
            await vi.waitFor(() => expect(screen.getState().session.id).toBe('a'));
            screen.getState().setUi((previous) => ({
                ...previous,
                autoApproveEdits: true,
                bypassPermissions: false,
            }));
            await vi.waitFor(() => expect(screen.getState().ui.autoApproveEdits).toBe(true));
            screen
                .getState()
                .setSession((previous) => ({ ...previous, id: null, hasActiveSession: false }));
            await vi.waitFor(() => expect(screen.getState().ui.autoApproveEdits).toBe(false));
        } finally {
            screen.close();
        }
    });
});
