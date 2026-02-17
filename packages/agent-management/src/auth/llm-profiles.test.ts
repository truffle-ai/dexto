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
        process.env.HOME = previousHome;
        await fs.rm(tempHomeDir, { recursive: true, force: true });
    });

    it('loads empty store when file missing', async () => {
        const store = await loadLlmAuthProfilesStore();
        expect(store.version).toBe(1);
        expect(store.defaults).toEqual({});
        expect(store.profiles).toEqual({});
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
