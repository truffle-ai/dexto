import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const entrypoint = fileURLToPath(new URL('../../index.ts', import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx');

it('shows a safe uninstall example in help and the CLI audit', () => {
    const testHome = mkdtempSync(join(tmpdir(), 'dexto-uninstall-help-'));
    const run = (...args: string[]) =>
        spawnSync(process.execPath, ['--import', tsx, entrypoint, ...args], {
            cwd: testHome,
            encoding: 'utf8',
            env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                HOME: testHome,
                USERPROFILE: testHome,
                DEXTO_ANALYTICS_DISABLED: '1',
            },
        });
    try {
        const help = run('uninstall', '--help');
        expect(help.status).toBe(0);
        expect(help.stdout).toContain('dexto uninstall --dry-run');
        const audit = run('--audit-agent-cli');
        expect(audit.status).toBe(0);
        expect(JSON.parse(audit.stdout)).toContainEqual(
            expect.objectContaining({
                command: 'uninstall',
                dryRun: true,
                examples: true,
                json: false,
            })
        );
    } finally {
        rmSync(testHome, { recursive: true, force: true });
    }
}, 60000);
