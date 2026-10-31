import { createElement } from 'react';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { Footer } from './Footer.js';
import type { TuiAgentBackend } from '../agent-backend.js';
import { setTuiRuntimeServices } from '../host/index.js';

describe('configured approval policy in the TUI footer', () => {
    it.each(['manual', 'auto-approve'])(
        'shows %s independently of session shortcuts',
        async (mode) => {
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
                await vi.waitFor(() => expect(output).toContain(`approvals: ${mode}`));
                expect(output).toContain('accept edits');
            } finally {
                view.unmount();
                stdout.destroy();
            }
        }
    );
});

describe('Dexto credits in the TUI footer', () => {
    async function renderFooter(provider: string, balance: number | null): Promise<string> {
        setTuiRuntimeServices({ dextoCreditBalance: async () => balance });
        const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 40, isTTY: false });
        let output = '';
        stdout.on('data', (chunk) => {
            output += String(chunk);
        });
        const agent = {
            capabilities: { contextStats: false },
            getEffectiveConfig: () => ({ permissions: { mode: 'manual' } }),
            getCurrentLLMConfig: () => ({ provider, model: 'openai/gpt-5' }),
            on: () => undefined,
        } as unknown as TuiAgentBackend;
        const view = render(
            createElement(Footer, { agent, sessionId: 'session-1', modelName: 'openai/gpt-5' }),
            {
                stdout: stdout as unknown as NodeJS.WriteStream,
                debug: true,
                patchConsole: false,
                exitOnCtrlC: false,
            }
        );
        try {
            await vi.waitFor(() => expect(output).toContain('approvals: manual'));
            await new Promise((resolve) => setTimeout(resolve, 20));
            return output;
        } finally {
            view.unmount();
            stdout.destroy();
            setTuiRuntimeServices({});
        }
    }

    it('shows the balance while a Dexto model runs, under the name Dexto', async () => {
        const output = await renderFooter('dexto-nova', 12.5);
        expect(output).toContain('$12.50 credits');
        expect(output).toContain('(Dexto)');
    });

    it('shows no balance for other providers', async () => {
        const output = await renderFooter('openai', 12.5);
        expect(output).not.toContain('credits');
    });
});
