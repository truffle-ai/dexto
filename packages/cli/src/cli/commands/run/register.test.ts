import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import type { DextoAgent, StreamingEvent } from '@dexto/core';
import { registerRunCommand } from './register.js';

const { safeExit } = vi.hoisted(() => ({ safeExit: vi.fn() }));
vi.mock('../../../analytics/wrapper.js', () => ({
    withAnalytics: (_name: string, handler: (...args: unknown[]) => unknown) => handler,
    safeExit,
    ExitSignal: class ExitSignal extends Error {},
}));
vi.mock('@dexto/agent-management', () => ({ resolveAgentPath: vi.fn(async () => '/agent.yml') }));
vi.mock('@dexto/core', () => ({
    safeStringify: JSON.stringify,
    isTextPart: (part: { type: string }) => part.type === 'text',
}));

function streamingAgent(events: StreamingEvent[]): DextoAgent {
    return {
        setApprovalHandler: vi.fn(),
        createSession: vi.fn(async () => ({ id: 'session-1' })),
        stream: vi.fn(async () =>
            (async function* () {
                yield* events;
            })()
        ),
        stop: vi.fn(async () => {}),
        getMcpServersWithStatus: () => [],
        getCurrentLLMConfig: () => ({ model: 'test-model', provider: 'test-provider' }),
        config: { permissions: { mode: 'auto-approve' } },
    } as unknown as DextoAgent;
}

const response = {
    name: 'llm:response',
    content: 'done',
    sessionId: 'session-1',
} as StreamingEvent;

describe('dexto run output', () => {
    let stdout: string[];
    let stderr: string[];
    beforeEach(() => {
        safeExit.mockReset();
        stdout = [];
        stderr = [];
        vi.spyOn(process.stdout, 'write').mockImplementation(
            (chunk, callback: string | ((error?: Error | null) => void) | undefined) => {
                stdout.push(String(chunk));
                if (typeof callback === 'function') callback();
                return true;
            }
        );
        vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
            stderr.push(String(chunk));
            return true;
        });
    });
    afterEach(() => vi.restoreAllMocks());

    async function run(args: string[], agent: DextoAgent | Error) {
        const program = new Command().exitOverride();
        const bootstrap = vi.fn(async () => {
            if (agent instanceof Error) throw agent;
            return agent;
        });
        registerRunCommand({
            program,
            cliVersion: 'test',
            bootstrapAgentFromGlobalOpts: bootstrap,
        });
        await program.parseAsync(['run', ...args], { from: 'user' });
        return { bootstrap, agent };
    }

    it('keeps plain assistant output as the default and diagnostics on stderr', async () => {
        await run(['task'], streamingAgent([response]));
        expect(stdout.join('')).toBe('done\n');
        expect(stderr.join('')).toContain('[RUN]');
    });

    it('keeps a final response followed by a fatal error failed', async () => {
        const agent = streamingAgent([
            response,
            {
                name: 'run:complete',
                finishReason: 'error',
                error: new Error('provider failed'),
                sessionId: 'session-1',
            } as StreamingEvent,
        ]);
        await run(['task', '--format', 'json'], agent);
        expect(JSON.parse(stdout.join(''))).toEqual({
            version: 1,
            status: 'failed',
            sessionId: 'session-1',
            content: 'done',
            error: 'provider failed',
        });
        expect(safeExit).toHaveBeenCalledWith('run', 1, 'fatal-error');
        expect(agent.stop).toHaveBeenCalledOnce();
    });

    it('rejects an unsupported format before starting an agent', async () => {
        const program = new Command().exitOverride();
        const bootstrap = vi.fn();
        registerRunCommand({
            program,
            cliVersion: 'test',
            bootstrapAgentFromGlobalOpts: bootstrap,
        });
        await expect(
            program.parseAsync(['run', 'task', '--format', 'yaml'], { from: 'user' })
        ).rejects.toThrow('Allowed choices');
        expect(bootstrap).not.toHaveBeenCalled();
        expect(stdout).toEqual([]);
    });

    it('includes total token usage in the terminal JSON result', async () => {
        await run(
            ['task', '--format', 'json'],
            streamingAgent([{ ...response, tokenUsage: { totalTokens: 42 } } as StreamingEvent])
        );
        expect(JSON.parse(stdout.join(''))).toEqual({
            version: 1,
            status: 'completed',
            sessionId: 'session-1',
            content: 'done',
            totalTokens: 42,
        });
    });

    it('reports recoverable errors, warnings, and tool results without failing successful work', async () => {
        await run(
            ['task', '--format', 'jsonl'],
            streamingAgent([
                {
                    name: 'llm:error',
                    recoverable: true,
                    error: new Error('retry'),
                    sessionId: 'session-1',
                } as StreamingEvent,
                {
                    name: 'llm:unsupported-input',
                    errors: ['attachment skipped'],
                    sessionId: 'session-1',
                } as StreamingEvent,
                {
                    name: 'llm:tool-result',
                    toolName: 'read_file',
                    success: false,
                    error: 'missing file',
                    callId: 'call-1',
                    sessionId: 'session-1',
                } as StreamingEvent,
                response,
            ])
        );
        const lines = stdout
            .join('')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(lines.slice(0, 3)).toEqual([
            { version: 1, type: 'run_error', recoverable: true, error: 'retry' },
            { version: 1, type: 'warning', errors: ['attachment skipped'] },
            {
                version: 1,
                type: 'tool_result',
                toolName: 'read_file',
                success: false,
                error: 'missing file',
                callId: 'call-1',
            },
        ]);
        expect(lines.at(-1)).toEqual({
            version: 1,
            type: 'complete',
            sessionId: 'session-1',
            content: 'done',
        });
        expect(safeExit).toHaveBeenCalledWith('run', 0, 'ok');
    });

    it('rejects an empty prompt with a structured result before bootstrap', async () => {
        const { bootstrap } = await run([' ', '--format', 'json'], streamingAgent([response]));
        expect(JSON.parse(stdout.join(''))).toEqual({
            version: 1,
            status: 'failed',
            error: 'Prompt cannot be empty.',
        });
        expect(bootstrap).not.toHaveBeenCalled();
        expect(safeExit).toHaveBeenCalledWith('run', 1, 'empty-prompt');
    });

    it('emits one JSONL failure when no final response is produced', async () => {
        const agent = streamingAgent([]);
        await run(['task', '--format', 'jsonl'], agent);
        expect(stdout).toHaveLength(1);
        expect(JSON.parse(stdout.join(''))).toEqual({
            version: 1,
            type: 'error',
            sessionId: 'session-1',
            error: 'No final response was produced.',
        });
        expect(safeExit).toHaveBeenCalledWith('run', 1, 'no-final-response');
        expect(agent.stop).toHaveBeenCalledOnce();
    });

    it('writes a structured failure when bootstrap throws', async () => {
        await run(['task', '--format', 'json'], new Error('Missing model credentials'));
        expect(stdout).toHaveLength(1);
        expect(JSON.parse(stdout.join(''))).toEqual({
            version: 1,
            status: 'failed',
            error: 'Missing model credentials',
        });
        expect(safeExit).toHaveBeenCalledWith('run', 1, 'error');
    });

    it('streams JSONL events and includes final content in one terminal result', async () => {
        await run(
            ['task', '--format', 'jsonl'],
            streamingAgent([
                { name: 'llm:chunk', content: 'do', sessionId: 'session-1' } as StreamingEvent,
                {
                    name: 'llm:tool-call',
                    toolName: 'read_file',
                    args: { path: 'README.md' },
                    callId: 'call-1',
                    sessionId: 'session-1',
                } as StreamingEvent,
                response,
            ])
        );
        const lines = stdout
            .join('')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(lines).toEqual([
            { version: 1, type: 'message_delta', content: 'do' },
            {
                version: 1,
                type: 'tool_call',
                toolName: 'read_file',
                args: { path: 'README.md' },
                callId: 'call-1',
            },
            { version: 1, type: 'response', content: 'done' },
            { version: 1, type: 'complete', sessionId: 'session-1', content: 'done' },
        ]);
    });

    it('waits for the terminal write callback before exiting', async () => {
        let finishWrite: (() => void) | undefined;
        vi.mocked(process.stdout.write).mockImplementation(
            (chunk, callback: string | ((error?: Error | null) => void) | undefined) => {
                stdout.push(String(chunk));
                if (typeof callback === 'function') finishWrite = callback;
                return false;
            }
        );
        const completion = run(['task', '--format', 'json'], streamingAgent([response]));
        await vi.waitFor(() => expect(stdout).toHaveLength(1));
        expect(safeExit).not.toHaveBeenCalled();
        expect(finishWrite).toBeDefined();
        finishWrite?.();
        await completion;
        expect(safeExit).toHaveBeenCalledWith('run', 0, 'ok');
    });

    it('waits for each JSONL write before consuming the next event', async () => {
        const callbacks: Array<() => void> = [];
        vi.mocked(process.stdout.write).mockImplementation(
            (chunk, callback: string | ((error?: Error | null) => void) | undefined) => {
                stdout.push(String(chunk));
                if (typeof callback === 'function') callbacks.push(callback);
                return false;
            }
        );
        const completion = run(
            ['task', '--format', 'jsonl'],
            streamingAgent([
                { name: 'llm:chunk', content: 'do', sessionId: 'session-1' } as StreamingEvent,
                response,
            ])
        );
        await vi.waitFor(() => expect(stdout.length).toBeGreaterThan(0));
        expect(stdout).toHaveLength(1);
        expect(safeExit).not.toHaveBeenCalled();
        callbacks.shift()?.();
        await vi.waitFor(() => expect(stdout).toHaveLength(2));
        callbacks.shift()?.();
        await vi.waitFor(() => expect(stdout).toHaveLength(3));
        expect(safeExit).not.toHaveBeenCalled();
        callbacks.shift()?.();
        await completion;
        expect(safeExit).toHaveBeenCalledWith('run', 0, 'ok');
    });

    it('writes a single JSON result rather than plain assistant text', async () => {
        const agent = streamingAgent([response]);
        await run(['task', '--format', 'json'], agent);
        expect(stdout).toHaveLength(1);
        expect(JSON.parse(stdout.join(''))).toEqual({
            version: 1,
            status: 'completed',
            sessionId: 'session-1',
            content: 'done',
        });
        expect(safeExit).toHaveBeenCalledWith('run', 0, 'ok');
        expect(agent.stop).toHaveBeenCalledOnce();
    });
});
