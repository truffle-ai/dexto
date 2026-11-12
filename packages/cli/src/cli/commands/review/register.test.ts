import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import type { DextoAgent, StreamingEvent } from '@dexto/core';
import { CommandFailure } from '../../failure.js';
import { NOTHING_TO_REVIEW, registerReviewCommand } from './register.js';
import type { GitRunner } from './review.js';

const { safeExit } = vi.hoisted(() => ({ safeExit: vi.fn() }));
vi.mock('../../../analytics/wrapper.js', () => ({
    withAnalytics: (_name: string, handler: (...args: unknown[]) => unknown) => handler,
    safeExit,
    ExitSignal: class ExitSignal extends Error {},
}));
vi.mock('@dexto/agent-management', () => ({
    resolveAgentPath: vi.fn(async () => '/agent.yml'),
    resolveBundledScript: vi.fn(() => '/skill.md'),
}));
vi.mock('@dexto/core', () => ({
    safeStringify: JSON.stringify,
    isTextPart: (part: { type: string }) => part.type === 'text',
    ApprovalType: { TOOL_APPROVAL: 'tool_approval', COMMAND_APPROVAL: 'command_approval' },
    ErrorType: { USER: 'user' },
    LLMErrorCode: { API_KEY_MISSING: 'llm_api_key_missing' },
    DextoRuntimeError: class DextoRuntimeError extends Error {},
}));

function reviewingAgent(): DextoAgent {
    return {
        setApprovalHandler: vi.fn(),
        createSession: vi.fn(async () => ({ id: 'session-1' })),
        stream: vi.fn(async () =>
            (async function* () {
                yield {
                    name: 'llm:response',
                    content: 'Looks good.',
                    sessionId: 'session-1',
                } as StreamingEvent;
            })()
        ),
        stop: vi.fn(async () => {}),
        getMcpServersWithStatus: () => [],
        getCurrentLLMConfig: () => ({ model: 'test-model', provider: 'test-provider' }),
        config: { permissions: { mode: 'auto-approve' } },
    } as unknown as DextoAgent;
}

const gitWith =
    (diff: string, untracked = ''): GitRunner =>
    async (args) => {
        const key = args.join(' ');
        if (key === 'rev-parse --is-inside-work-tree') return 'true\n';
        if (key === 'merge-base main HEAD') return 'abc123\n';
        if (key === 'diff --no-color --no-ext-diff abc123') return diff;
        if (key === 'ls-files --others --exclude-standard') return untracked;
        throw new Error(`git ${key} failed`);
    };

describe('dexto review', () => {
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

    async function review(args: string[], git: GitRunner, agent = reviewingAgent()) {
        const program = new Command().exitOverride();
        const bootstrap = vi.fn(async () => agent);
        registerReviewCommand(
            { program, cliVersion: 'test', bootstrapAgentFromGlobalOpts: bootstrap },
            { git, readSkill: async () => '# Code Review Skill' }
        );
        await program.parseAsync(['review', ...args], { from: 'user' });
        return { bootstrap, agent };
    }

    it('sends the skill and the diff to a fresh agent and prints the review as JSON', async () => {
        const { agent, bootstrap } = await review(
            ['--base', 'main', '--focus', 'security', '--json'],
            gitWith('+changed\n')
        );
        expect(bootstrap).toHaveBeenCalledWith({ mode: 'headless-run' });
        const prompt = vi.mocked(agent.stream).mock.calls[0]?.[0];
        expect(prompt).toContain('# Code Review Skill');
        expect(prompt).toContain('+changed');
        expect(prompt).toContain('Focus area: security');
        expect(JSON.parse(stdout.join(''))).toMatchObject({
            type: 'result',
            status: 'completed',
            content: 'Looks good.',
        });
        expect(safeExit).toHaveBeenCalledWith('review', 0, 'ok');
    });

    it('passes --model to the agent', async () => {
        const { bootstrap } = await review(
            ['--base', 'main', '-m', 'gpt-5', '--json'],
            gitWith('+changed\n')
        );
        expect(bootstrap).toHaveBeenCalledWith({ mode: 'headless-run', modelOverride: 'gpt-5' });
    });

    it('exits 0 without starting an agent when nothing changed', async () => {
        const { bootstrap } = await review(['--base', 'main', '--json'], gitWith(''));
        expect(bootstrap).not.toHaveBeenCalled();
        expect(JSON.parse(stdout.join(''))).toMatchObject({
            status: 'completed',
            content: NOTHING_TO_REVIEW,
        });
        expect(safeExit).toHaveBeenCalledWith('review', 0, 'no-work');
    });

    it('prints the plain no-work line with --text', async () => {
        await review(['--base', 'main', '--text'], gitWith(''));
        expect(stdout.join('')).toBe(`${NOTHING_TO_REVIEW}\n`);
    });

    it('reviews untracked files even when tracked files are unchanged', async () => {
        const { agent } = await review(['--base', 'main', '--json'], gitWith('', 'new.ts\n'));
        expect(vi.mocked(agent.stream).mock.calls[0]?.[0]).toContain('- new.ts');
    });

    it('exits 2 outside a git repository, without starting an agent', async () => {
        const { bootstrap } = await review(['--json'], async () => {
            throw new Error('fatal: not a git repository');
        });
        expect(bootstrap).not.toHaveBeenCalled();
        expect(JSON.parse(stdout.join(''))).toMatchObject({
            status: 'failed',
            error: { code: 'invalid_input' },
        });
        expect(safeExit).toHaveBeenCalledWith('review', 2, 'error');
    });

    it('exits 5 with a fix when the base does not exist', async () => {
        await review(['--base', 'missing', '--json'], gitWith('+x\n'));
        expect(JSON.parse(stderr.join(''))).toMatchObject({
            error: { code: 'not_found', fix: 'dexto review --base <branch>' },
        });
        expect(safeExit).toHaveBeenCalledWith('review', 5, 'error');
    });

    it('keeps a skill read failure a plain failure', async () => {
        const program = new Command().exitOverride();
        registerReviewCommand(
            {
                program,
                cliVersion: 'test',
                bootstrapAgentFromGlobalOpts: vi.fn(async () => reviewingAgent()),
            },
            {
                git: gitWith('+x\n'),
                readSkill: async () => {
                    throw new CommandFailure('failed', 'skill missing', null);
                },
            }
        );
        await program.parseAsync(['review', '--base', 'main', '--json'], { from: 'user' });
        expect(safeExit).toHaveBeenCalledWith('review', 1, 'error');
    });

    it('refuses two output formats with exit 2', async () => {
        await review(['--json', '--text'], gitWith('+x\n'));
        expect(safeExit).toHaveBeenCalledWith('review', 2, 'usage');
    });
});
