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
    ApprovalType: { TOOL_APPROVAL: 'tool_approval', COMMAND_APPROVAL: 'command_approval' },
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

    it('prints the plain reply with --text, diagnostics on stderr', async () => {
        await run(['task', '--text'], streamingAgent([response]));
        expect(stdout.join('')).toBe('done\n');
        expect(stderr.join('')).toContain('[RUN]');
    });

    it('prints JSON by default when stdout is not a terminal', async () => {
        await run(['task'], streamingAgent([response]));
        expect(JSON.parse(stdout.join(''))).toMatchObject({ type: 'result', status: 'completed' });
    });

    it('lists approvals no one could give as permission denials, and still completes', async () => {
        await run(
            ['task', '--stream-json'],
            streamingAgent([
                {
                    name: 'approval:request',
                    type: 'tool_approval',
                    approvalId: 'apr-1',
                    sessionId: 'session-1',
                    metadata: { toolName: 'bash_exec', toolCallId: 'call-9', args: {} },
                    timestamp: new Date(),
                } as unknown as StreamingEvent,
                response,
            ])
        );
        const lines = stdout
            .join('')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        const denial = {
            approval_id: 'apr-1',
            session_id: 'session-1',
            approval_type: 'tool_approval',
            tool_name: 'bash_exec',
            tool_call_id: 'call-9',
        };
        expect(lines[0]).toMatchObject({ type: 'approval_required', ...denial });
        expect(lines.at(-1)).toMatchObject({
            type: 'result',
            status: 'completed',
            permission_denials: [expect.objectContaining(denial)],
        });
        expect(safeExit).toHaveBeenCalledWith('run', 0, 'ok');
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
        await run(['task', '--json'], agent);
        expect(JSON.parse(stdout.join(''))).toEqual({
            type: 'result',
            status: 'failed',
            session_id: 'session-1',
            content: 'done',
            error: { code: 'failed', message: 'provider failed' },
            permission_denials: [],
        });
        expect(safeExit).toHaveBeenCalledWith('run', 1, 'fatal-error');
        expect(agent.stop).toHaveBeenCalledOnce();
    });

    it('refuses --json with --stream-json before starting an agent: exit 2', async () => {
        const { bootstrap } = await run(
            ['task', '--json', '--stream-json'],
            streamingAgent([response])
        );
        expect(bootstrap).not.toHaveBeenCalled();
        expect(safeExit).toHaveBeenCalledWith('run', 2, 'usage');
        expect(stdout).toEqual([]);
        expect(stderr.join('')).toContain('Pass --json, --stream-json or --text, only one.');
    });

    it('reports recoverable errors, warnings, and tool results without failing successful work', async () => {
        await run(
            ['task', '--stream-json'],
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
            { type: 'run_error', recoverable: true, error: 'retry' },
            { type: 'warning', errors: ['attachment skipped'] },
            {
                type: 'tool_result',
                tool_name: 'read_file',
                success: false,
                error: 'missing file',
                call_id: 'call-1',
            },
        ]);
        expect(lines.at(-1)).toEqual({
            type: 'result',
            status: 'completed',
            session_id: 'session-1',
            content: 'done',
            permission_denials: [],
        });
        expect(safeExit).toHaveBeenCalledWith('run', 0, 'ok');
    });

    it('rejects an empty prompt with a structured result before bootstrap', async () => {
        const { bootstrap } = await run([' ', '--json'], streamingAgent([response]));
        expect(JSON.parse(stdout.join(''))).toEqual({
            type: 'result',
            status: 'failed',
            error: { code: 'usage', message: 'Prompt cannot be empty.' },
            permission_denials: [],
        });
        expect(bootstrap).not.toHaveBeenCalled();
        expect(safeExit).toHaveBeenCalledWith('run', 2, 'empty-prompt');
    });

    it('emits one JSONL failure when no final response is produced', async () => {
        const agent = streamingAgent([]);
        await run(['task', '--stream-json'], agent);
        expect(stdout).toHaveLength(1);
        expect(JSON.parse(stdout.join(''))).toEqual({
            type: 'result',
            status: 'failed',
            session_id: 'session-1',
            error: { code: 'failed', message: 'No final response was produced.' },
            permission_denials: [],
        });
        expect(safeExit).toHaveBeenCalledWith('run', 1, 'no-final-response');
        expect(agent.stop).toHaveBeenCalledOnce();
    });

    it('writes a structured failure when bootstrap throws', async () => {
        await run(['task', '--json'], new Error('Missing model credentials'));
        expect(stdout).toHaveLength(1);
        expect(JSON.parse(stdout.join(''))).toEqual({
            type: 'result',
            status: 'failed',
            error: { code: 'failed', message: 'Missing model credentials' },
            permission_denials: [],
        });
        expect(stderr.join('')).toContain(
            JSON.stringify({ error: { code: 'failed', message: 'Missing model credentials' } })
        );
        expect(safeExit).toHaveBeenCalledWith('run', 1, 'error');
    });

    it('streams JSONL events and includes final content in one terminal result', async () => {
        await run(
            ['task', '--stream-json'],
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
            { type: 'message_delta', content: 'do' },
            {
                type: 'tool_call',
                tool_name: 'read_file',
                args: { path: 'README.md' },
                call_id: 'call-1',
            },
            { type: 'response', content: 'done' },
            {
                type: 'result',
                status: 'completed',
                session_id: 'session-1',
                content: 'done',
                permission_denials: [],
            },
        ]);
    });

    it('resets abandoned reasoning before retry output in JSONL', async () => {
        await run(
            ['task', '--stream-json'],
            streamingAgent([
                {
                    name: 'llm:chunk',
                    chunkType: 'reasoning',
                    content: 'abandoned reasoning',
                    sessionId: 'session-1',
                },
                {
                    name: 'llm:retrying',
                    reason: 'empty_response',
                    error: new Error('The model ended its reply without answering'),
                    context: 'TurnExecutor.runModelStep',
                    attempt: 1,
                    maxRetries: 1,
                    provider: 'openai',
                    model: 'gpt-4o',
                    sessionId: 'session-1',
                },
                {
                    name: 'llm:chunk',
                    chunkType: 'text',
                    content: 'done',
                    sessionId: 'session-1',
                },
                response,
            ])
        );
        const lines = stdout
            .join('')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(lines).toEqual([
            { type: 'message_delta', content: 'abandoned reasoning' },
            { type: 'message_reset', reason: 'empty_response' },
            { type: 'message_delta', content: 'done' },
            { type: 'response', content: 'done' },
            {
                type: 'result',
                status: 'completed',
                session_id: 'session-1',
                content: 'done',
                permission_denials: [],
            },
        ]);
    });

    it('does not reset JSONL output for a transient-error retry', async () => {
        await run(
            ['task', '--stream-json'],
            streamingAgent([
                {
                    name: 'llm:retrying',
                    reason: 'transient_error',
                    error: new Error('Retryable transport failure'),
                    context: 'TurnExecutor.runModelStep',
                    attempt: 1,
                    maxRetries: 2,
                    provider: 'openai',
                    model: 'gpt-4o',
                    sessionId: 'session-1',
                },
                response,
            ])
        );
        const lines = stdout
            .join('')
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(lines).toEqual([
            { type: 'response', content: 'done' },
            {
                type: 'result',
                status: 'completed',
                session_id: 'session-1',
                content: 'done',
                permission_denials: [],
            },
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
        const completion = run(['task', '--json'], streamingAgent([response]));
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
            ['task', '--stream-json'],
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
        await run(['task', '--json'], agent);
        expect(stdout).toHaveLength(1);
        expect(JSON.parse(stdout.join(''))).toEqual({
            type: 'result',
            status: 'completed',
            session_id: 'session-1',
            content: 'done',
            permission_denials: [],
        });
        expect(safeExit).toHaveBeenCalledWith('run', 0, 'ok');
        expect(agent.stop).toHaveBeenCalledOnce();
    });
});
