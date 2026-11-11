import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '@dexto/core/workspace';
import { LocalSkills } from '@dexto/agent-management';
import { LocalWorkspaceHandleProvider } from '../src/local-workspace-handle-provider.js';

const execFile = promisify(execFileCallback);

describe('LocalWorkspaceHandleProvider', () => {
    let workspaceRoot: string;

    beforeEach(async () => {
        workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'dexto-workspace-'));
    });

    afterEach(async () => {
        await rm(workspaceRoot, { force: true, recursive: true });
    });

    function context(): WorkspaceContext {
        return {
            id: 'workspace-id',
            path: workspaceRoot,
            createdAt: 1,
            lastActiveAt: 1,
        };
    }

    it('reads and globs files from the local workspace root', async () => {
        const skillDir = path.join(workspaceRoot, '.agents', 'skills', 'local');
        await mkdir(skillDir, { recursive: true });
        await writeFile(path.join(skillDir, 'SKILL.md'), '# Local Skill\n', 'utf-8');
        await writeFile(path.join(skillDir, 'notes.md'), 'Use the local workspace.\n', 'utf-8');
        await mkdir(path.join(workspaceRoot, 'src', 'nested'), { recursive: true });
        await writeFile(path.join(workspaceRoot, 'src', 'index.ts'), 'export {};\n', 'utf-8');
        await writeFile(
            path.join(workspaceRoot, 'src', 'nested', 'component.test.ts'),
            'test();\n',
            'utf-8'
        );

        const provider = new LocalWorkspaceHandleProvider();
        const handle = await provider.open({
            context: context(),
            input: { intent: 'read' },
        });

        expect('root' in handle.context).toBe(false);
        await expect(handle.files.glob('.agents/skills/*/SKILL.md')).resolves.toEqual([
            '.agents/skills/local/SKILL.md',
        ]);
        await expect(handle.files.glob('src/**/*.ts')).resolves.toEqual([
            'src/index.ts',
            'src/nested/component.test.ts',
        ]);
        await expect(handle.files.glob('src/**/*.test.ts')).resolves.toEqual([
            'src/nested/component.test.ts',
        ]);
        await expect(handle.files.readText('.agents/skills/local/SKILL.md')).resolves.toBe(
            '# Local Skill\n'
        );
        await expect(handle.files.readText(path.join(skillDir, 'notes.md'))).resolves.toBe(
            'Use the local workspace.\n'
        );
    });

    it('creates parent directories when writing files', async () => {
        const provider = new LocalWorkspaceHandleProvider();
        const handle = await provider.open({
            context: context(),
            input: { intent: 'write' },
        });

        await expect(
            handle.files.writeFile('created/file.txt', 'created')
        ).resolves.toBeUndefined();
        await expect(handle.files.readText('created/file.txt')).resolves.toBe('created');
    });

    it('rejects reads outside the workspace root', async () => {
        const outsideFile = path.join(os.tmpdir(), `dexto-outside-${Date.now()}.txt`);
        await writeFile(outsideFile, 'outside', 'utf-8');
        const provider = new LocalWorkspaceHandleProvider();
        const handle = await provider.open({ context: context() });

        await expect(handle.files.readText('../outside.txt')).rejects.toThrow(
            'Workspace path escapes root'
        );
        await expect(handle.files.readText(outsideFile)).rejects.toThrow(
            'Workspace path escapes root'
        );

        await rm(outsideFile, { force: true });
    });

    it('lets LocalSkills discover workspace skills with supporting files', async () => {
        const skillDir = path.join(workspaceRoot, '.agents', 'skills', 'local');
        await mkdir(path.join(skillDir, 'references'), { recursive: true });
        await writeFile(path.join(skillDir, 'SKILL.md'), '# Local Skill\n', 'utf-8');
        await writeFile(path.join(skillDir, 'references', 'guide.md'), 'Local guide.\n', 'utf-8');

        const skills = new LocalSkills(() => [
            {
                name: 'local',
                skillFile: path.join(skillDir, 'SKILL.md'),
            },
        ]);

        await expect(skills.list()).resolves.toEqual([
            { name: 'local', description: 'Instructions for the local skill.' },
        ]);
        await expect(skills.load('local')).resolves.toMatchObject({
            name: 'local',
            supportingFiles: ['references/guide.md'],
            filesLocation: 'workspace',
            baseDirectory: skillDir,
        });
        await expect(skills.readFile('local', 'references/guide.md')).resolves.toBe(
            'Local guide.\n'
        );
    });

    it('reports a file size without reading it, inside the workspace only', async () => {
        const provider = new LocalWorkspaceHandleProvider();
        const handle = await provider.open({ context: context(), input: { intent: 'read' } });
        const outsideFile = path.join(path.dirname(workspaceRoot), 'outside-sized.txt');
        await writeFile(path.join(workspaceRoot, 'sized.txt'), 'héllo');
        await writeFile(outsideFile, 'x');
        await symlink(outsideFile, path.join(workspaceRoot, 'link.txt'));

        try {
            await expect(handle.files.readFileSize?.('sized.txt')).resolves.toBe(6);
            await expect(handle.files.readFileSize?.('missing.txt')).rejects.toThrow();
            await expect(handle.files.readFileSize?.('link.txt')).rejects.toThrow();
        } finally {
            await rm(outsideFile, { force: true });
        }
    });

    it('advertises process capability only when requested', async () => {
        const provider = new LocalWorkspaceHandleProvider();

        const readHandle = await provider.open({ context: context(), input: { intent: 'read' } });
        expect(readHandle.capabilities).toEqual(['files']);
        expect(readHandle.processes).toBeUndefined();

        const processHandle = await provider.open({
            context: context(),
            input: { intent: 'process' },
        });
        expect(processHandle.capabilities).toEqual(['files', 'processes']);
        await expect(processHandle.processes?.exec({ command: 'pwd' })).resolves.toEqual({
            exitCode: 0,
            stdout: `${await realpath(workspaceRoot)}\n`,
            stderr: '',
        });
    });

    describe('foreground commands', () => {
        const startedPids: number[] = [];

        afterEach(() => {
            for (const pid of startedPids.splice(0)) {
                try {
                    process.kill(pid, 'SIGKILL');
                } catch {
                    // Already stopped.
                }
            }
        });

        async function openProcesses() {
            const handle = await new LocalWorkspaceHandleProvider().open({
                context: context(),
                input: { intent: 'process' },
            });
            if (handle.processes === undefined) throw new Error('Expected a process handle');
            return handle.processes;
        }

        /** Pids of running processes whose command line matches `pattern`. */
        async function pidsMatching(pattern: string): Promise<number[]> {
            try {
                const { stdout } = await execFile('pgrep', ['-f', pattern]);
                return stdout.split('\n').filter(Boolean).map(Number);
            } catch {
                // pgrep exits 1 when nothing matches.
                return [];
            }
        }

        function isAlive(pid: number): boolean {
            try {
                process.kill(pid, 0);
                return true;
            } catch {
                return false;
            }
        }

        async function waitUntilStopped(pid: number): Promise<void> {
            const deadline = Date.now() + 5000;
            while (isAlive(pid)) {
                if (Date.now() > deadline) throw new Error(`Process ${pid} is still running`);
                await new Promise((resolve) => setTimeout(resolve, 25));
            }
        }

        // The inner shell prints its pid, then sleeps; the outer shell has to wait for it.
        const commandWithChild = "sh -c 'echo $$; sleep 60'; echo done";

        function childPidOf(stdout: string): number {
            const pid = Number(stdout.split('\n')[0]);
            startedPids.push(pid);
            return pid;
        }

        it('returns a non-zero exit with its output instead of throwing', async () => {
            const processes = await openProcesses();

            await expect(
                processes.exec({ command: 'echo out; echo err >&2; exit 3' })
            ).resolves.toEqual({ exitCode: 3, stdout: 'out\n', stderr: 'err\n' });
        });

        it.skipIf(process.platform === 'win32')(
            'stops the command and the processes it started when the timeout passes',
            async () => {
                const processes = await openProcesses();

                const startedAt = Date.now();
                const result = await processes.exec({ command: commandWithChild, timeout: 500 });

                expect(result.timedOut).toBe(true);
                expect(Date.now() - startedAt).toBeLessThan(10_000);
                await waitUntilStopped(childPidOf(result.stdout));
            }
        );

        it.skipIf(process.platform === 'win32')(
            'stops the command and the processes it started when the signal aborts',
            async () => {
                const processes = await openProcesses();
                const controller = new AbortController();
                setTimeout(() => controller.abort(), 500);

                const result = await processes.exec({
                    command: commandWithChild,
                    signal: controller.signal,
                });

                expect(result.exitCode).toBe(130);
                expect(result.stdout).toContain('(Command was cancelled)');
                await waitUntilStopped(childPidOf(result.stdout));
            }
        );

        it.skipIf(process.platform === 'win32')(
            'kills a child that ignores SIGTERM and has its output redirected away',
            async () => {
                const processes = await openProcesses();
                // A sleep length no other process uses, so pgrep finds only this child.
                const marker = `6000.${Math.floor(Math.random() * 1_000_000)}`;
                const pattern = `sleep ${marker}`;

                try {
                    const result = await processes.exec({
                        command: `(trap "" TERM; sleep ${marker}) >/dev/null 2>&1 & wait`,
                        timeout: 500,
                    });

                    expect(result.timedOut).toBe(true);
                    const deadline = Date.now() + 3000;
                    while ((await pidsMatching(pattern)).length > 0) {
                        if (Date.now() > deadline) {
                            throw new Error('The child ignoring SIGTERM is still running');
                        }
                        await new Promise((resolve) => setTimeout(resolve, 25));
                    }
                } finally {
                    // Never leave the sleeping child behind, whatever the outcome.
                    for (const pid of await pidsMatching(pattern)) startedPids.push(pid);
                }
            }
        );

        it('does not start a command when the signal has already aborted', async () => {
            const processes = await openProcesses();

            const result = await processes.exec({
                command: `touch ${path.join(workspaceRoot, 'ran')}`,
                signal: AbortSignal.abort(),
            });

            expect(result.exitCode).toBe(130);
            await expect(readFile(path.join(workspaceRoot, 'ran'))).rejects.toThrow();
        });
    });
});
