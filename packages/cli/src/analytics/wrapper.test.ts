import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { buildArgsPayload, withAnalytics } from './wrapper.js';
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
    it('writes all of a large output to a slow pipe before the process exits', async () => {
        const bytes = 1024 * 1024;
        const runtime = new URL('../cli/cloud/runtime.ts', import.meta.url).href;
        const wrapper = new URL('./wrapper.ts', import.meta.url).href;
        // The real output and exit path: the cloud runtime writes stdout without waiting, then the
        // command ends through safeExit, as every engine command does.
        const script = `
            const { nodeCloudRuntime } = await import(${JSON.stringify(runtime)});
            const { withAnalytics, safeExit } = await import(${JSON.stringify(wrapper)});
            nodeCloudRuntime(new AbortController().signal).writeOutput('x'.repeat(${bytes}));
            await withAnalytics('large-output', () => safeExit('large-output', 0), { timeoutMs: 0 })();
        `;
        const child = spawn(
            process.execPath,
            [
                '--import',
                createRequire(import.meta.url).resolve('tsx'),
                '--input-type=module',
                '-e',
                script,
            ],
            {
                env: { ...process.env, DEXTO_ANALYTICS_DISABLED: '1' },
                stdio: ['ignore', 'pipe', 'inherit'],
            }
        );
        // A slow reader, like `| (sleep 1; wc -c)`: the pipe fills while the child finishes.
        await new Promise((resolve) => setTimeout(resolve, 1000));
        let received = 0;
        child.stdout.on('data', (chunk: Buffer) => (received += chunk.length));
        const code = await new Promise((resolve) => child.on('close', resolve));
        expect(code).toBe(0);
        expect(received).toBe(bytes);
    }, 30_000);
});
