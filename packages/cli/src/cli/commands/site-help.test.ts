import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('rejects site help and points to publish', async () => {
    const entry = fileURLToPath(new URL('../../index.ts', import.meta.url));
    const tsx = createRequire(import.meta.url).resolve('tsx');
    const result = await promisify(execFile)(process.execPath, [
        '--import',
        tsx,
        entry,
        'site',
        '--help',
    ]).catch((error: { code: number; stderr: string }) => error);
    expect('code' in result ? result.code : 0).toBe(2);
    expect(result.stderr).toContain('dexto publish');
});

it('documents cloud chat list help with the --local switch', async () => {
    const entry = fileURLToPath(new URL('../../index.ts', import.meta.url));
    const tsx = createRequire(import.meta.url).resolve('tsx');
    const result = await promisify(execFile)(process.execPath, [
        '--import',
        tsx,
        entry,
        'chat',
        'list',
        '--help',
    ]);
    expect(result.stdout).toContain('--local');
    expect(result.stdout).toContain('dexto chat list --query');
});
