import { describe, expect, it } from 'vitest';
import type { Message } from '../state/types.js';
import { backgroundFailure, finishedToolStep, toolOutput, toolStep } from './tool-step.js';

function tool(overrides: Partial<Message>): Message {
    return {
        id: 'tool-1',
        role: 'tool',
        content: 'Read(src/a.ts)',
        timestamp: new Date(0),
        toolName: 'read_file',
        toolStatus: 'finished',
        ...overrides,
    };
}

describe('toolStep', () => {
    it.each([
        ['pending', 'queue'],
        ['pending_approval', 'wait'],
        ['running', 'run'],
        ['finished', 'ok'],
    ] as const)('maps tool status %s to step state %s', (toolStatus, state) => {
        expect(toolStep(tool({ toolStatus })).state).toBe(state);
    });

    it('marks a failed, a denied and a stopped call', () => {
        expect(toolStep(tool({ isError: true })).state).toBe('fail');
        expect(toolStep(tool({ isError: true, toolOutcome: 'denied' })).state).toBe('deny');
        expect(toolStep(tool({ isError: true, toolOutcome: 'cancelled' })).state).toBe('stop');
    });

    it.each([
        ['read_file', 'READ'],
        ['write_file', 'WRITE'],
        ['edit_file', 'EDIT'],
        ['bash_exec', 'RUN'],
        ['grep_content', 'SEARCH'],
        ['glob_files', 'GLOB'],
        ['spawn_agent', 'TASK'],
        ['mcp--github--create_pull_request', 'MCP'],
    ])('names %s as %s', (toolName, verb) => {
        expect(toolStep(tool({ toolName })).verb).toBe(verb);
    });

    it('falls back to the first word of an unknown tool, at most 7 cells', () => {
        expect(toolStep(tool({ toolName: 'summarize_everything' })).verb).toBe('SUMMARI');
    });

    it('names an MCP target by server and tool, then its arguments', () => {
        const step = toolStep(
            tool({
                toolName: 'mcp--github--create_pull_request',
                content: 'Create Pull Request(title=x) [MCP: github]\nOpening the PR',
                toolArgs: 'title=x',
            })
        );
        expect(step.target).toBe('github.create_pull_request title=x');
    });

    it('shows file paths relative to the working directory', () => {
        const step = toolStep(tool({ toolArgs: `${process.cwd()}/src/a.ts` }));
        expect(step.target).toBe('src/a.ts');
    });

    it('reads a multi-line command on one row', () => {
        const step = toolStep(tool({ toolName: 'bash_exec', toolArgs: 'echo a\n  echo $(b)' }));
        expect(step.target).toBe('echo a echo $(b)');
    });

    it('sums up an edit, with hunks when there are several', () => {
        const toolDisplayData = {
            type: 'diff',
            unified: '@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-c\n+d',
            filename: 'a.ts',
            additions: 31,
            deletions: 12,
        } as const;
        expect(toolStep(tool({ toolDisplayData })).detail).toBe('+31 −12 · 2 hunks');
    });

    it('sums up a shell run by lines of output and by exit code', () => {
        const shell = { type: 'shell', command: 'x', duration: 5, stdout: 'a\nb\n' } as const;
        expect(toolStep(tool({ toolDisplayData: { ...shell, exitCode: 0 } })).detail).toBe(
            '2 lines'
        );
        expect(
            toolStep(tool({ isError: true, toolDisplayData: { ...shell, exitCode: 3 } })).detail
        ).toBe('exit 3');
    });

    it('sums up a search by hits and files', () => {
        const match = { line: 1, content: 'x' };
        const toolDisplayData = {
            type: 'search' as const,
            pattern: 'x',
            matches: [
                { ...match, file: 'a' },
                { ...match, file: 'a' },
                { ...match, file: 'b' },
            ],
            totalMatches: 3,
            truncated: false,
        };
        expect(toolStep(tool({ toolDisplayData })).detail).toBe('3 hits · 2 files');
    });

    it('says when a capped search has more than it counted', () => {
        const toolDisplayData = {
            type: 'search' as const,
            pattern: 'x',
            matches: [{ file: 'a', line: 1, content: 'x' }],
            totalMatches: 1,
            truncated: true,
        };
        expect(toolStep(tool({ toolDisplayData })).detail).toBe('1+ hits · 1+ files');
    });

    it('sums up a file read and a created file', () => {
        const file = { type: 'file', path: 'a', lineCount: 88 } as const;
        expect(toolStep(tool({ toolDisplayData: { ...file, operation: 'read' } })).detail).toBe(
            '88 lines'
        );
        expect(toolStep(tool({ toolDisplayData: { ...file, operation: 'create' } })).detail).toBe(
            'new · 88 lines'
        );
    });

    it('says a denied call was denied and counts a sub-agent while it runs', () => {
        expect(toolStep(tool({ isError: true, toolOutcome: 'denied' })).detail).toBe('you denied');
        const subAgentProgress = {
            task: 't',
            agentId: 'a',
            toolsCalled: 3,
            currentTool: 'read_file',
        };
        expect(toolStep(tool({ toolStatus: 'running', subAgentProgress })).detail).toBe(
            '3 tools so far'
        );
    });

    it('counts a command that exited nonzero as failed', () => {
        const toolDisplayData = {
            type: 'shell',
            command: 'x',
            duration: 5,
            exitCode: 2,
        } as const;
        expect(toolStep(tool({ toolDisplayData })).state).toBe('fail');
    });

    it('times a shell run from its own duration, and no other tool', () => {
        const toolDisplayData = {
            type: 'shell',
            command: 'x',
            duration: 4200,
            exitCode: 0,
        } as const;
        expect(toolStep(tool({ toolDisplayData })).time).toBe('4.2s');
        expect(toolStep(tool({})).time).toBeNull();
    });
});

describe('toolOutput', () => {
    it('shows nothing for a call that worked', () => {
        expect(toolOutput(tool({ toolResult: 'all fine' }))).toEqual([]);
    });

    it('shows the last lines of a failed shell run, stderr first', () => {
        const stderr = Array.from({ length: 9 }, (_, i) => `line ${i}`).join('\n');
        const lines = toolOutput(
            tool({
                isError: true,
                toolDisplayData: {
                    type: 'shell',
                    command: 'x',
                    exitCode: 1,
                    duration: 1,
                    stdout: 'out',
                    stderr,
                },
            })
        );
        expect(lines).toEqual(['line 4', 'line 5', 'line 6', 'line 7', 'line 8']);
    });

    it('keeps the output of a command that exited nonzero', () => {
        const lines = toolOutput(
            tool({
                toolDisplayData: {
                    type: 'shell',
                    command: 'x',
                    exitCode: 1,
                    duration: 1,
                    stdout: 'expected 1, got 2',
                },
            })
        );
        expect(lines).toEqual(['expected 1, got 2']);
    });

    it('shows the error text of any other failed call', () => {
        expect(toolOutput(tool({ isError: true, toolResult: 'ENOENT: a.ts\n' }))).toEqual([
            'ENOENT: a.ts',
        ]);
    });

    it('stays quiet for a denied or stopped call', () => {
        const cancelled = { isError: true, toolResult: 'Cancelled' };
        expect(toolOutput(tool({ ...cancelled, toolOutcome: 'denied' }))).toEqual([]);
        expect(toolOutput(tool({ ...cancelled, toolOutcome: 'cancelled' }))).toEqual([]);
    });
});

describe('backgroundFailure', () => {
    it('reads a failed bash_output as a failed row with its output', () => {
        const failure = backgroundFailure('bash_output', {
            status: 'failed',
            stderr: 'boom',
            stdout: 'out',
            exit_code: 2,
        });
        expect(failure).toEqual({ toolOutcome: 'failed', toolFailureText: 'boom' });
        const message = tool({ toolName: 'bash_output', ...failure });
        expect(toolStep(message).state).toBe('fail');
        expect(toolOutput(message)).toEqual(['boom']);
    });

    it('falls back to the exit code when there is no output', () => {
        expect(
            backgroundFailure('bash_output', { status: 'failed', stderr: '', exit_code: 2 })
        ).toEqual({ toolOutcome: 'failed', toolFailureText: 'exit 2' });
    });

    it('ignores a running or completed process and any other tool', () => {
        expect(backgroundFailure('bash_output', { status: 'completed' })).toEqual({});
        expect(backgroundFailure('read_file', { status: 'failed' })).toEqual({});
    });
});

describe('finishedToolStep', () => {
    it('builds the row from the call itself', () => {
        const { step, output } = finishedToolStep({
            toolName: 'bash_exec',
            args: { command: 'make' },
            presentationSnapshot: {
                version: 1,
                source: { type: 'local' },
                header: { title: 'Bash', argsText: 'make' },
            },
            success: true,
        });
        expect(step.verb).toBe('RUN');
        expect(step.target).toBe('make');
        expect(step.state).toBe('ok');
        expect(output).toEqual([]);
    });

    it('carries why a call failed, including a failed background readback', () => {
        const failed = finishedToolStep({
            toolName: 'read_file',
            args: {},
            success: false,
            error: 'ENOENT',
        });
        expect(failed.step.state).toBe('fail');
        expect(failed.output).toEqual(['ENOENT']);

        const readback = finishedToolStep({
            toolName: 'bash_output',
            args: {},
            success: true,
            rawResult: { status: 'failed', stderr: 'boom' },
        });
        expect(readback.step.state).toBe('fail');
        expect(readback.output).toEqual(['boom']);
    });
});
