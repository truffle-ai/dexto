import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const scripts = dirname(fileURLToPath(import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx/cli');

describe('CLI bundled build files', () => {
    it.each([
        ['copy-agents.ts', 'agents/agent-registry.json', 'dist/agents/agent-registry.json'],
        ['copy-assets.ts', 'src/cli/assets/example.txt', 'dist/cli/assets/example.txt'],
    ])(
        'copies files when %s runs from an encoded checkout path',
        async (script, source, output) => {
            const root = await mkdtemp(join(tmpdir(), 'dexto build #'));
            try {
                const cli = join(root, 'packages', 'cli');
                await mkdir(join(cli, 'scripts'), { recursive: true });
                const sourcePath =
                    script === 'copy-agents.ts' ? join(root, source) : join(cli, source);
                await mkdir(dirname(sourcePath), { recursive: true });
                await writeFile(sourcePath, 'bundled fixture');
                const scriptPath = join(cli, 'scripts', script);
                await copyFile(join(scripts, script), scriptPath);
                await execute(process.execPath, [tsx, scriptPath], { cwd: root, timeout: 20_000 });
                expect(await readFile(join(cli, output), 'utf8')).toBe('bundled fixture');
            } finally {
                await rm(root, { recursive: true, force: true });
            }
        }
    );
});
