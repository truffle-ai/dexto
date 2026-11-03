import { describe, expect, it, vi } from 'vitest';
import { createOutput } from '../output.js';
import { nodeCloudRuntime } from '../runtime.js';
import type { CommandContext } from '../command.js';
import { importCommands } from './import.js';
import { findLocalChats } from '../../import/local-chats.js';

vi.mock('../../import/local-chats.js', () => ({
    findLocalChats: vi.fn(async () => ({ chats: [], notices: [] })),
}));
vi.mock('./workspace.js', () => ({
    queryWorkspaceTool: vi.fn(async () => ({
        session: { id: 'created' },
        status: 'imported',
        url: 'https://example.test/chat',
    })),
}));

describe('headless import', () => {
    it('discovers both sources without authentication or network access', async () => {
        let output = '';
        const runtime = {
            ...nodeCloudRuntime(new AbortController().signal),
            prompt: null,
            stdoutIsTerminal: false,
            writeOutput: (text: string) => {
                output += text;
            },
        };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands.find((item) => item.path.length === 1);
        if (!command) throw new Error('missing import command');
        await command.run(context, { positionals: [], values: {} });
        expect(JSON.parse(output)).toMatchObject({ sessions: [] });
    });

    it('fails safely when the current session cannot be identified', async () => {
        const runtime = {
            ...nodeCloudRuntime(new AbortController().signal),
            environment: {},
            prompt: null,
        };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands.find((item) => item.path.length === 1);
        if (!command) throw new Error('missing import command');
        await expect(
            command.run(context, { positionals: [], values: { 'current-session': true } })
        ).rejects.toThrow(/current session/i);
    });

    it('previews selected redacted messages without authenticating', async () => {
        const chat = {
            id: 'test-1',
            source: 'codex' as const,
            title: 'Test',
            cwd: '/tmp/test',
            gitBranch: null,
            path: '/tmp/test.jsonl',
            pullRequests: [],
            repository: null,
            startedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            messages: [
                {
                    role: 'user' as const,
                    text: 'password=supersecretvalue',
                    createdAt: '2026-01-01T00:00:00Z',
                },
            ],
        };
        vi.mocked(findLocalChats)
            .mockResolvedValueOnce({ chats: [], notices: [] })
            .mockResolvedValueOnce({ chats: [chat], notices: [] });
        let output = '';
        const runtime = {
            ...nodeCloudRuntime(new AbortController().signal),
            prompt: null,
            writeOutput: (text: string) => {
                output += text;
            },
        };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands[0];
        if (!command) throw new Error('missing import command');
        expect(
            await command.run(context, {
                positionals: [],
                values: { select: 'codex:test-1', 'dry-run': true },
            })
        ).toBe(0);
        expect(output).toContain('[redacted:assignment]');
        expect(output).not.toContain('supersecretvalue');
    });

    it('requires consent before uploading a selected session', async () => {
        const chat = {
            id: 'test-2',
            source: 'codex' as const,
            title: 'Test',
            cwd: '/tmp/test',
            gitBranch: null,
            path: '/tmp/test.jsonl',
            pullRequests: [],
            repository: null,
            startedAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            messages: [{ role: 'user' as const, text: 'hello', createdAt: '2026-01-01T00:00:00Z' }],
        };
        vi.mocked(findLocalChats)
            .mockResolvedValueOnce({ chats: [], notices: [] })
            .mockResolvedValueOnce({ chats: [chat], notices: [] });
        const runtime = { ...nodeCloudRuntime(new AbortController().signal), prompt: null };
        const context: CommandContext = {
            runtime,
            output: createOutput(runtime, 'json'),
            invocation: ['import'],
            overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
            connection: async () => {
                throw new Error('unexpected authentication');
            },
            client: async () => {
                throw new Error('unexpected network');
            },
        };
        const command = importCommands[0];
        if (!command) throw new Error('missing import command');
        await expect(
            command.run(context, { positionals: [], values: { select: 'codex:test-2' } })
        ).rejects.toMatchObject({ kind: 'needs_confirmation' });
    });
});
