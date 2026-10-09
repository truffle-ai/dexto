import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const entrypoint = fileURLToPath(new URL('../../index.ts', import.meta.url));
const loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const PROCESS_DEADLINE_MS = 20000;

type CliProcess = {
    child: ChildProcess;
    output: () => string;
    exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
};

async function listen(server: Server, port = 0): Promise<number> {
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '0.0.0.0', () => {
            server.off('error', reject);
            resolve();
        });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
    return address.port;
}

async function close(server: Server): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
}

async function withinDeadline<T>(promise: Promise<T>, description: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(description)), PROCESS_DEADLINE_MS);
            }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

// Exercise the real CLI with an isolated home/workspace and no model requests.
describe('CLI server process lifecycle', () => {
    let directory: string;
    let configPath: string;
    const processes: CliProcess[] = [];

    beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'dexto-server-'));
        await mkdir(join(directory, 'home'));
        configPath = join(directory, 'agent.yml');
        await writeFile(
            configPath,
            `systemPrompt: Answer briefly.
llm:
  provider: openai-compatible
  model: lifecycle-model
  apiKey: unused-local-test-key
  maxInputTokens: 32768
  baseURL: http://127.0.0.1:1/v1
permissions:
  mode: auto-approve
storage:
  cache:
    type: in-memory
  database:
    type: in-memory
`
        );
    });

    afterEach(async () => {
        try {
            for (const process of processes.splice(0)) {
                if (process.child.exitCode === null && process.child.signalCode === null) {
                    // Force cleanup even when the behavior under test fails or hangs.
                    process.child.kill('SIGKILL');
                }
                await withinDeadline(process.exited, `CLI cleanup timed out: ${process.output()}`);
            }
        } finally {
            if (directory) await rm(directory, { recursive: true, force: true });
        }
    });

    function start(port: number): CliProcess {
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            HOME: join(directory, 'home'),
            USERPROFILE: join(directory, 'home'),
            DEXTO_ANALYTICS_DISABLED: '1',
            DEXTO_FEATURE_AUTH: 'false',
            DEXTO_NO_UPDATE_CHECK: 'true',
            DEXTO_LLM_REGISTRY_DISABLE_FETCH: '1',
            NO_COLOR: '1',
        };
        // Parent shell settings must not replace the explicit test port or URL.
        env.PORT = String(port);
        delete env.DEXTO_URL;
        delete env.DEXTO_DEV_MODE;
        const child = spawn(
            process.execPath,
            [
                '--import',
                loader,
                entrypoint,
                '--agent',
                configPath,
                '--no-auto-install',
                '--no-interactive',
                '--mode',
                'server',
                '--port',
                String(port),
            ],
            { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] }
        );
        let output = '';
        child.stdout?.on('data', (chunk: Buffer) => {
            output += chunk.toString();
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            output += chunk.toString();
        });
        const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
            (resolve, reject) => {
                child.once('error', reject);
                child.once('close', (code, signal) => resolve({ code, signal }));
            }
        );
        const cli = { child, output: () => output, exited };
        processes.push(cli);
        return cli;
    }

    async function waitForReadiness(cli: CliProcess): Promise<void> {
        let check: () => void = () => {};
        let onClose: () => void = () => {};
        const ready = new Promise<void>((resolve, reject) => {
            check = () => {
                if (cli.output().includes('Server running at')) resolve();
            };
            onClose = () => reject(new Error(`CLI exited before readiness:\n${cli.output()}`));
            cli.child.stdout?.on('data', check);
            cli.child.stderr?.on('data', check);
            cli.child.once('close', onClose);
            check();
        });
        try {
            await withinDeadline(ready, 'CLI never announced readiness');
        } catch (error) {
            throw new Error(`${String(error)}\n${cli.output()}`);
        } finally {
            cli.child.stdout?.off('data', check);
            cli.child.stderr?.off('data', check);
            cli.child.off('close', onClose);
        }
    }

    async function reservePort(): Promise<number> {
        const reservation = createServer();
        const port = await listen(reservation);
        await close(reservation);
        return port;
    }

    it('serves health immediately after announcing readiness', async () => {
        const port = await reservePort();
        const cli = start(port);
        await waitForReadiness(cli);
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
            signal: AbortSignal.timeout(3000),
            headers: { Connection: 'close' },
        });
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('OK');
    }, 30000);

    it.skipIf(process.platform === 'win32')(
        'exits cleanly on SIGTERM and releases its listening port',
        async () => {
            // Windows kill(SIGTERM) forcibly terminates the process rather than delivering
            // POSIX SIGTERM; the host tests independently cover cleanup on that platform.
            const port = await reservePort();
            const cli = start(port);
            await waitForReadiness(cli);
            expect(cli.child.kill('SIGTERM')).toBe(true);
            const result = await withinDeadline(cli.exited, 'CLI did not exit after SIGTERM').catch(
                (error: Error) => {
                    throw new Error(`${error.message}\n${cli.output()}`);
                }
            );
            expect(result, cli.output()).toEqual({ code: 0, signal: null });
            const replacement = createServer();
            try {
                expect(await listen(replacement, port)).toBe(port);
            } finally {
                if (replacement.listening) await close(replacement);
            }
        },
        30000
    );

    it('exits nonzero on an occupied port without announcing readiness', async () => {
        const occupied = createServer();
        const port = await listen(occupied);
        try {
            const cli = start(port);
            const result = await withinDeadline(
                cli.exited,
                'CLI did not exit after a bind failure'
            ).catch((error: Error) => {
                throw new Error(`${error.message} (expected port ${port})\n${cli.output()}`);
            });
            expect(result.code, cli.output()).toBe(1);
            expect(cli.output()).toContain('EADDRINUSE');
            expect(cli.output()).not.toContain('Server running at');
        } finally {
            await close(occupied);
        }
    }, 30000);
});
