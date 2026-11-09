import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateEnvFile } from './env-file.js';

describe('updateEnvFile', () => {
    let dir: string;
    let envPath: string;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'env-file-'));
        envPath = path.join(dir, '.env');
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('updates existing keys and appends new ones', async () => {
        await writeFile(envPath, 'A=1\nB=2\n');
        await updateEnvFile(envPath, { B: '3', C: '4' });
        const lines = (await readFile(envPath, 'utf8')).split('\n');
        expect(lines).toEqual(expect.arrayContaining(['A=1', 'B=3', 'C=4']));
        expect(lines).not.toContain('B=2');
    });

    it('rejects a value that spans lines and leaves the file alone', async () => {
        await writeFile(envPath, 'A=1\n');
        await expect(updateEnvFile(envPath, { KEY: 'x\nOTHER=y' })).rejects.toThrow(/single line/);
        await expect(updateEnvFile(envPath, { KEY: 'x\r\nOTHER=y' })).rejects.toThrow(
            /single line/
        );
        expect(await readFile(envPath, 'utf8')).toBe('A=1\n');
    });

    it('rejects a key that is not a plain variable name', async () => {
        await expect(updateEnvFile(envPath, { 'KEY=1\nOTHER': 'y' })).rejects.toThrow(/name/);
    });

    it('keeps the file readable by its owner only', async () => {
        await writeFile(envPath, 'A=1\n', { mode: 0o644 });
        await updateEnvFile(envPath, { A: '2' });
        expect((await stat(envPath)).mode & 0o777).toBe(0o600);

        await rm(envPath);
        await updateEnvFile(envPath, { A: '2' });
        expect((await stat(envPath)).mode & 0o777).toBe(0o600);
    });
});
