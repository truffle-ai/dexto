import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { parse } from 'yaml';

const require = createRequire(import.meta.url);
const tsx = pathToFileURL(require.resolve('tsx')).href;
const entrypoint = fileURLToPath(new URL('../../../index.ts', import.meta.url));
const directories: string[] = [];
const processes: ChildProcess[] = [];
afterEach(async () => {
    await Promise.all(
        processes.splice(0).map(async (child) => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(
                    () => reject(new Error('Owned CLI did not close after fixture cleanup')),
                    3000
                );
                child.once('close', () => {
                    clearTimeout(timeout);
                    resolve();
                });
                child.kill('SIGKILL');
            });
        })
    );
    await Promise.all(
        directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
    );
});

function run(directory: string, args: string[], preload: string, gated: boolean) {
    const cli = spawn(
        process.execPath,
        [
            '--import',
            pathToFileURL(preload).href,
            '--import',
            tsx,
            entrypoint,
            'mcp',
            ...args,
            '--config',
            join(directory, 'mcp.yml'),
            '--json',
        ],
        {
            cwd: directory,
            env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                HOME: directory,
                USERPROFILE: directory,
                DEXTO_DEV_MODE: 'false',
                DEXTO_ANALYTICS_DISABLED: '1',
                DEXTO_LLM_REGISTRY_DISABLE_FETCH: '1',
                ...(gated
                    ? {
                          MCP_GATE_CONFIG: join(directory, 'mcp.yml'),
                          MCP_GATE_READY: join(directory, 'ready'),
                          MCP_GATE_RELEASE: join(directory, 'release'),
                      }
                    : {}),
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );
    processes.push(cli);
    let stdout = '',
        stderr = '';
    cli.stdout?.on('data', (chunk) => {
        stdout += chunk;
    });
    cli.stderr?.on('data', (chunk) => {
        stderr += chunk;
    });
    return new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
            const timeout = setTimeout(() => {
                cli.kill('SIGKILL');
                reject(new Error(`CLI deadline: ${stderr}`));
            }, 15000);
            cli.once('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });
            cli.once('close', (code) => {
                clearTimeout(timeout);
                resolve({ code, stdout, stderr });
            });
        }
    );
}
async function waitForFile(path: string) {
    for (let attempt = 0; attempt < 160; attempt++) {
        try {
            await access(path);
            return;
        } catch {
            /* not yet ready */
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('CLI did not reach its YAML read');
}

async function prepare(initial: string) {
    const directory = await mkdtemp(join(tmpdir(), 'dexto-mcp-contention-'));
    directories.push(directory);
    const config = join(directory, 'mcp.yml');
    const preload = join(directory, 'gate.mjs');
    await writeFile(config, initial);
    await writeFile(
        preload,
        `
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const read = fs.readFile.bind(fs);
let gated = false;
fs.readFile = async (...args) => {
    const value = await read(...args);
    if (!gated && String(args[0]) === process.env.MCP_GATE_CONFIG) {
        gated = true;
        await fs.writeFile(process.env.MCP_GATE_READY, 'ready');
        while (true) {
            try { await fs.access(process.env.MCP_GATE_RELEASE); break; } catch {}
            await new Promise(resolve => setTimeout(resolve, 20));
        }
    }
    return value;
};
syncBuiltinESMExports();
`
    );
    return { directory, config, preload };
}

it.each(['add', 'remove'] as const)(
    'rejects an add competing with %s ownership and preserves retries',
    async (firstCommand) => {
        const { directory, config, preload } = await prepare(
            firstCommand === 'add'
                ? '# retain this comment\nmcpServers: {}\n'
                : '# retain this comment\nmcpServers:\n  obsolete:\n    type: stdio\n    command: never-execute\n'
        );
        const serverConfig = JSON.stringify({ type: 'stdio', command: 'never-execute' });
        const first = run(
            directory,
            firstCommand === 'add'
                ? ['add', 'first', '--server-config', serverConfig]
                : ['remove', 'obsolete'],
            preload,
            true
        );
        try {
            await waitForFile(join(directory, 'ready'));
            const competing = await run(
                directory,
                ['add', 'second', '--server-config', serverConfig],
                preload,
                false
            );
            await writeFile(join(directory, 'release'), 'release');
            expect(await first).toMatchObject({ code: 0, stderr: '' });
            expect(competing).toMatchObject({ code: 2, stderr: '' });
            expect(JSON.parse(competing.stdout)).toEqual({
                error: {
                    code: 'config_busy',
                    message:
                        'MCP configuration is being edited. Retry after the current edit completes.',
                },
            });
            expect(
                await run(
                    directory,
                    ['add', 'second', '--server-config', serverConfig],
                    preload,
                    false
                )
            ).toMatchObject({ code: 0, stderr: '' });
            const final = await readFile(config, 'utf8');
            expect(Object.keys(parse(final).mcpServers)).toEqual(
                firstCommand === 'add' ? ['first', 'second'] : ['second']
            );
            expect(final).toContain('# retain this comment');
        } finally {
            await writeFile(join(directory, 'release'), 'release');
            await first;
        }
    },
    30000
);

it('preserves an existing busy lock and permits read-only CLI commands', async () => {
    const { directory, config, preload } = await prepare('mcpServers: {}\n');
    const lock = `${config}.lock`;
    await writeFile(lock, 'existing owner');
    expect(
        await run(
            directory,
            [
                'add',
                'local',
                '--server-config',
                JSON.stringify({ type: 'stdio', command: 'never-execute' }),
            ],
            preload,
            false
        )
    ).toMatchObject({ code: 2, stderr: '' });
    const listed = await run(directory, ['list'], preload, false);
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.stdout)).toEqual({ servers: [] });
    expect(await readFile(lock, 'utf8')).toBe('existing owner');
    expect(await readFile(config, 'utf8')).toBe('mcpServers: {}\n');
}, 30000);
