import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
    getDefaultLlmAuthProfileId,
    getLlmAuthProfilesPath,
    loadLlmAuthProfilesStore,
    setDefaultLlmAuthProfile,
    upsertLlmAuthProfile,
    deleteLlmAuthProfile,
} from './llm-profiles.js';

describe('llm-profiles store', () => {
    let tempHomeDir: string;
    let previousHome: string | undefined;

    beforeEach(async () => {
        tempHomeDir = await fs.mkdtemp(path.join(tmpdir(), 'dexto-llm-profiles-test-'));
        previousHome = process.env.HOME;
        process.env.HOME = tempHomeDir;
    });

    afterEach(async () => {
        if (previousHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = previousHome;
        }
        await fs.rm(tempHomeDir, { recursive: true, force: true });
    });

    it('loads empty store when file missing', async () => {
        const store = await loadLlmAuthProfilesStore();
        expect(store.version).toBe(1);
        expect(store.defaults).toEqual({});
        expect(store.profiles).toEqual({});
    });

    it('backs up a corrupt store file and returns an empty store', async () => {
        const filePath = getLlmAuthProfilesPath();
        await fs.mkdir(path.dirname(filePath), { recursive: true });

        const corrupt = '{not-json';
        await fs.writeFile(filePath, corrupt, { encoding: 'utf-8' });

        const store = await loadLlmAuthProfilesStore();
        expect(store.defaults).toEqual({});
        expect(store.profiles).toEqual({});

        await expect(fs.stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });

        const dir = path.dirname(filePath);
        const entries = await fs.readdir(dir);
        const backups = entries.filter((e) => e.startsWith('llm-profiles.json.corrupt.'));
        expect(backups).toHaveLength(1);

        const backupPath = path.join(dir, backups[0]!);
        const backupContent = await fs.readFile(backupPath, 'utf-8');
        expect(backupContent).toBe(corrupt);

        const stat = await fs.stat(backupPath);
        expect(stat.mode & 0o777).toBe(0o600);
    });

    it('upserts profiles, forces permissions, and tracks defaults', async () => {
        await upsertLlmAuthProfile({
            profileId: 'openai:default',
            providerId: 'openai',
            methodId: 'api_key',
            credential: { type: 'api_key', key: 'sk-test-123' },
        });

        const store = await loadLlmAuthProfilesStore();
        expect(store.profiles['openai:default']?.providerId).toBe('openai');

        const filePath = getLlmAuthProfilesPath();
        const stat = await fs.stat(filePath);
        expect(stat.mode & 0o777).toBe(0o600);

        await setDefaultLlmAuthProfile({ providerId: 'openai', profileId: 'openai:default' });
        expect(await getDefaultLlmAuthProfileId('openai')).toBe('openai:default');

        await deleteLlmAuthProfile('openai:default');
        expect(await getDefaultLlmAuthProfileId('openai')).toBe(null);
    });
});
