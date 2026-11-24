import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syncCloudSkillsAtStart } from './skills-sync.js';

const mocks = vi.hoisted(() => ({ resolveConnection: vi.fn(), skillsDirectory: '' }));

vi.mock('./connection.js', () => ({ resolveConnection: mocks.resolveConnection }));
vi.mock('@dexto/agent-management', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@dexto/agent-management')>()),
    getStandaloneSkillPaths: () => ({ cloud: mocks.skillsDirectory }),
}));

const SKILL_ID = '00000000-0000-4000-8000-000000000001';

/** A signed-in person whose one Skill is still downloading when the start-up deadline passes. */
function cutShortByTheDeadline() {
    mocks.resolveConnection.mockResolvedValue({
        apiBaseUrl: 'https://api.dexto.test',
        kind: 'oauth',
        token: 'person-token',
    });
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    vi.stubGlobal('fetch', async (input: globalThis.Request) => {
        const url = new URL(input.url);
        if (url.pathname === '/v1/skills')
            return Response.json({
                data: [
                    {
                        description: '',
                        id: SKILL_ID,
                        object: 'skill',
                        release: { digest: 'a', version: '1' },
                        slug: 'release-notes',
                        source: 'user',
                        title: 'release-notes',
                        visibility: 'private',
                    },
                ],
                has_more: false,
                next_after: null,
                object: 'list',
            });
        deadline.abort(new Error('timed out'));
        throw deadline.signal.reason;
    });
}

let stderr: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
    mocks.skillsDirectory = path.join(
        await mkdtemp(path.join(os.tmpdir(), 'dexto-cloud-skills-')),
        'cache'
    );
    stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mocks.resolveConnection.mockReset();
    await rm(path.dirname(mocks.skillsDirectory), { recursive: true, force: true });
});

describe('syncCloudSkillsAtStart', () => {
    it('tells a person at a terminal about a sync cut short, and a JSON mode nothing', async () => {
        cutShortByTheDeadline();
        await syncCloudSkillsAtStart({ jsonMode: false });
        expect(stderr).toHaveBeenCalledWith(
            'Synced 0 more of your Dexto Skills; 1 still to sync at your next session, or now with dexto skills sync.\n'
        );

        stderr.mockClear();
        cutShortByTheDeadline();
        await syncCloudSkillsAtStart({ jsonMode: true });
        expect(stderr).not.toHaveBeenCalled();
    });

    it('tells a person at a terminal about a failed sync, and a JSON mode nothing', async () => {
        mocks.resolveConnection.mockRejectedValue(new TypeError('fetch failed'));
        await syncCloudSkillsAtStart({ jsonMode: false });
        expect(stderr).toHaveBeenCalledWith(
            "Couldn't sync your Dexto Skills (fetch failed). Using the last synced copy; run dexto skills sync to retry.\n"
        );

        stderr.mockClear();
        await syncCloudSkillsAtStart({ jsonMode: true });
        expect(stderr).not.toHaveBeenCalled();
    });
});
