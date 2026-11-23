import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildArgsPayload, safeExit, withAnalytics } from './wrapper.js';
import { vi } from 'vitest';

vi.mock('./index.js', () => ({
    initAnalytics: vi.fn(),
    onCommandStart: vi.fn(),
    onCommandEnd: vi.fn(),
    capture: vi.fn(),
}));
import { onCommandEnd } from './index.js';

describe('command analytics metadata', () => {
    it('omits thrown error messages from command events', async () => {
        const secret = 'synthetic-secret-value';
        const run = withAnalytics(
            'test',
            () => {
                throw new Error(secret);
            },
            { timeoutMs: 0 }
        );
        await expect(run()).rejects.toThrow(secret);
        expect(onCommandEnd).toHaveBeenCalledWith('test', false, { args: { argTypes: [] } });
        expect(JSON.stringify(vi.mocked(onCommandEnd).mock.calls)).not.toContain(secret);
    });
    it('does not include positional values or option values', () => {
        const secret = 'synthetic-secret-value';
        const metadata = buildArgsPayload([
            [`https://example.invalid/${secret}`],
            { endpoint: secret },
        ]);
        expect(metadata).toEqual({ argTypes: ['array', 'object'], positionalCount: 1 });
        expect(JSON.stringify(metadata)).not.toContain(secret);
    });
});

describe('command exit', () => {
    it('exits without writing again when nothing is left to flush', async () => {
        // A zero-length write to a pipe whose reader has gone can raise EPIPE on macOS, so an
        // already flushed stream must not be written to at all (`dexto ... --json | head -1`).
        vi.spyOn(process.stdout, 'writableLength', 'get').mockReturnValue(0);
        vi.spyOn(process.stderr, 'writableLength', 'get').mockReturnValue(0);
        const stdoutWrite = vi.spyOn(process.stdout, 'write');
        const stderrWrite = vi.spyOn(process.stderr, 'write');
        const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
        try {
            // process.exit is stubbed, so the wrapper goes on to rethrow the exit signal.
            await expect(
                withAnalytics('flushed', () => safeExit('flushed', 0), { timeoutMs: 0 })()
            ).rejects.toThrow('ExitSignal');
            expect(exit).toHaveBeenCalledWith(0);
            expect(stdoutWrite).not.toHaveBeenCalled();
            expect(stderrWrite).not.toHaveBeenCalled();
        } finally {
            vi.restoreAllMocks();
            process.exitCode = 0;
        }
    });

    it('writes all of a large output to a slow pipe before the process exits', async () => {
        const bytes = 1024 * 1024;
        const child = spawnCommandWritingOutput(bytes, 0, { analytics: false });
        // A slow reader, like `| (sleep 1; wc -c)`: the pipe fills while the child finishes.
        await new Promise((resolve) => setTimeout(resolve, 1000));
        let received = 0;
        child.stdout.on('data', (chunk: Buffer) => (received += chunk.length));
        const code = await new Promise((resolve) => child.on('close', resolve));
        expect(code).toBe(0);
        expect(received).toBe(bytes);
    }, 30_000);

    it.each([
        ['analytics off', false],
        // Recording the command's end waits on I/O, so the reader's close can land before the flush.
        ['analytics on', true],
    ])(
        'exits with the command code when the reader closes early (%s)',
        async (_, analytics) => {
            const child = spawnCommandWritingOutput(1024 * 1024, 3, { analytics });
            let stderr = '';
            child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
            // A reader that stops early, like `| head -c 10`: close the pipe at its first bytes.
            child.stdout.once('data', () => child.stdout.destroy());
            const code = await new Promise((resolve) => child.on('close', resolve));
            expect(stderr).toBe('');
            expect(code).toBe(3);
        },
        30_000
    );
});

/**
 * Runs the real output and exit path in a child: the cloud runtime writes `bytes` to stdout
 * without waiting, then the command ends through safeExit with `code`, as every engine command does.
 * With analytics on, its state goes to a temporary home and events to a closed local port.
 */
function spawnCommandWritingOutput(bytes: number, code: number, options: { analytics: boolean }) {
    const runtimeModule = new URL('../cli/cloud/runtime.ts', import.meta.url).href;
    const wrapper = new URL('./wrapper.ts', import.meta.url).href;
    const script = `
        const { nodeCloudRuntime } = await import(${JSON.stringify(runtimeModule)});
        const { withAnalytics, safeExit } = await import(${JSON.stringify(wrapper)});
        const runtime = nodeCloudRuntime(new AbortController().signal);
        await withAnalytics('output', () => {
            runtime.writeOutput('x'.repeat(${bytes}));
            safeExit('output', ${code});
        }, { timeoutMs: 0 })();
    `;
    const tsx = createRequire(import.meta.url).resolve('tsx');
    const { DEXTO_ANALYTICS_DISABLED: _, ...env } = process.env;
    const analyticsEnv = options.analytics
        ? {
              HOME: mkdtempSync(path.join(tmpdir(), 'dexto-exit-')),
              DEXTO_POSTHOG_KEY: 'phc_test',
              DEXTO_POSTHOG_HOST: 'http://127.0.0.1:9',
          }
        : { DEXTO_ANALYTICS_DISABLED: '1' };
    return spawn(process.execPath, ['--import', tsx, '--input-type=module', '-e', script], {
        env: { ...env, ...analyticsEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}
