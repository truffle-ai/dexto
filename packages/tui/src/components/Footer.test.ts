import { createElement } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { Footer } from './Footer.js';
import type { TuiAgentBackend } from '../agent-backend.js';

describe('configured approval policy in the TUI footer', () => {
    it.each([
        ['asks-you', 'Asks you'],
        ['full-access', 'Full access'],
    ])('shows %s as "%s" independently of session shortcuts', async (mode, label) => {
        const stdout = Object.assign(new PassThrough(), {
            columns: 120,
            rows: 40,
            isTTY: false,
        });
        let output = '';
        stdout.on('data', (chunk) => {
            output += String(chunk);
        });
        const agent = {
            capabilities: { contextStats: false },
            getEffectiveConfig: () => ({ permissions: { mode } }),
        } as unknown as TuiAgentBackend;
        const view = render(
            createElement(Footer, {
                agent,
                sessionId: null,
                modelName: 'test-model',
                autoApproveEdits: true,
            }),
            {
                stdout: stdout as unknown as NodeJS.WriteStream,
                debug: true,
                patchConsole: false,
                exitOnCtrlC: false,
            }
        );
        try {
            await vi.waitFor(() => expect(output).toContain(`permissions: ${label}`));
            expect(output).toContain('accept edits');
        } finally {
            view.unmount();
            stdout.destroy();
        }
    });
});
