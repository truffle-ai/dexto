import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

it.skipIf(process.platform === 'win32')(
    'finishes Git before a terminal-group SIGINT can interrupt it',
    async () => {
        const directory = await mkdtemp(path.join(tmpdir(), 'dexto-git-signal-'));
        const marker = path.join(directory, 'started');
        const source = pathToFileURL(path.join(import.meta.dirname, 'git.ts')).href;
        const script = `import { handOffGit } from ${JSON.stringify(source)};
        process.on('SIGINT', () => {});
        const result = await handOffGit(process.cwd(), ['-c', 'alias.handoff-wait=!echo started > "$DEXTO_TEST_GIT_MARKER"; sleep 0.4; echo finished', 'handoff-wait']);
        process.stdout.write(result);`;
        const driver = spawn(
            process.execPath,
            ['--import', import.meta.resolve('tsx'), '--input-type=module', '-e', script],
            {
                cwd: process.cwd(),
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, DEXTO_TEST_GIT_MARKER: marker },
            }
        );
        const pid = driver.pid;
        if (pid === undefined) throw new Error('Test driver did not start.');
        let output = '';
        let error = '';
        driver.stdout.setEncoding('utf8').on('data', (chunk: string) => {
            output += chunk;
        });
        driver.stderr.setEncoding('utf8').on('data', (chunk: string) => {
            error += chunk;
        });
        const finished = new Promise<number | null>((resolve, reject) => {
            driver.once('error', reject);
            driver.once('close', resolve);
        });
        try {
            let started = false;
            for (let attempt = 0; attempt < 200 && !started; attempt += 1) {
                started = await readFile(marker, 'utf8')
                    .then(() => true)
                    .catch(() => false);
                if (!started) await new Promise((resolve) => setTimeout(resolve, 10));
            }
            if (!started) throw new Error(`Git did not start: ${error}`);
            process.kill(-pid, 'SIGINT');
            expect(await finished, error).toBe(0);
            expect(output).toContain('finished');
        } finally {
            if (driver.exitCode === null) driver.kill();
            await rm(directory, { recursive: true, force: true });
        }
    },
    15_000
);
