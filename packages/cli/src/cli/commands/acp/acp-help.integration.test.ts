import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const entrypoint = fileURLToPath(new URL('../../../index.ts', import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx');

it('shows the ACP server usage example and records it without a JSON option', () => {
    const run = (...args: string[]) =>
        spawnSync(process.execPath, ['--import', tsx, entrypoint, ...args], {
            encoding: 'utf8',
            env: {
                PATH: process.env.PATH,
                SystemRoot: process.env.SystemRoot,
                DEXTO_ANALYTICS_DISABLED: '1',
            },
        });
    const help = run('acp', '--help');
    expect(help.status).toBe(0);
    expect(help.stdout).toMatch(/Examples:\s*\n\s*dexto acp\s*\n/u);
    expect(help.stdout).toContain('Stdout carries only ACP messages');
    const audit = run('--audit-agent-cli');
    expect(audit.status).toBe(0);
    expect(JSON.parse(audit.stdout)).toContainEqual(
        expect.objectContaining({ command: 'acp', examples: true, json: false })
    );
}, 60000);
