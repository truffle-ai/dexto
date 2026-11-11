import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
    preparePersonalSkill,
    selectPersonalSkillSlug,
    importPersonalSkill,
    requireSkillProvenance,
} from './import-skills.js';
import { queryWorkspaceTool } from './workspace.js';
import { sendBytes } from '../transfer.js';
import { createOutput } from '../output.js';
import { nodeCloudRuntime } from '../runtime.js';
import type { CommandContext } from '../command.js';

vi.mock('./workspace.js', () => ({ queryWorkspaceTool: vi.fn(), listWorkspaceTools: vi.fn() }));
vi.mock('../transfer.js', () => ({ sendBytes: vi.fn() }));

function context(): CommandContext {
    const runtime = { ...nodeCloudRuntime(new AbortController().signal), prompt: null };
    return {
        runtime,
        output: createOutput(runtime, 'json'),
        invocation: ['import'],
        overrides: { apiBaseUrl: null, apiKey: null, cloudProject: null, profile: null },
        connection: async () => {
            throw new Error('unexpected');
        },
        client: async () => {
            throw new Error('unexpected');
        },
    };
}
async function fixture() {
    const home = await mkdtemp(path.join(tmpdir(), 'skill-import-'));
    const dir = path.join(home, 'sample');
    await mkdir(dir);
    await writeFile(
        path.join(dir, 'SKILL.md'),
        '---\nname: sample\ndescription: Test skill\n---\npassword=supersecretvalue\n'
    );
    return { source: 'codex' as const, name: 'sample', path: dir };
}
describe('personal skill import', () => {
    it('prepares redacted bundles and rejects binary files', async () => {
        const skill = await fixture();
        const prepared = await preparePersonalSkill(skill);
        expect(prepared.redactions).toBe(1);
        expect(Buffer.from(prepared.archive).toString('utf8')).not.toContain('supersecretvalue');
        await writeFile(path.join(skill.path, 'image.png'), Buffer.from([0xff, 0]));
        await expect(preparePersonalSkill(skill)).rejects.toMatchObject({ kind: 'invalid_input' });
    });
    it('requires provenance support before uploading', async () => {
        expect(() => requireSkillProvenance()).toThrow(/provenance/i);
        expect(sendBytes).not.toHaveBeenCalled();
    });
    it('requires a clash choice for JSON, or uses skip or a free rename', async () => {
        const skill = await fixture();
        const prepared = await preparePersonalSkill(skill);
        vi.mocked(queryWorkspaceTool).mockResolvedValue({
            skills: [{ slug: 'sample', source: 'user', visibility: 'private' }],
        });
        await expect(
            selectPersonalSkillSlug(context(), prepared, 'ask', new Set())
        ).rejects.toMatchObject({ kind: 'needs_confirmation' });
        expect(await selectPersonalSkillSlug(context(), prepared, 'skip', new Set())).toBeNull();
        expect(await selectPersonalSkillSlug(context(), prepared, 'rename', new Set())).toBe(
            'sample-2'
        );
    });
    it('uploads only in create mode with provenance', async () => {
        const skill = await fixture();
        const prepared = await preparePersonalSkill(skill);
        vi.mocked(queryWorkspaceTool)
            .mockReset()
            .mockResolvedValueOnce({
                headers: {},
                method: 'PUT',
                path: 'staged',
                url: 'https://example.test/upload',
            })
            .mockResolvedValueOnce({ slug: 'sample', location: { skillId: 'skill-1' } });
        const result = await importPersonalSkill(context(), skill, prepared, 'sample');
        expect(result.status).toBe('imported');
        expect(vi.mocked(queryWorkspaceTool).mock.calls[1]?.[2]).toMatchObject({
            mode: 'create',
            importProvenance: {
                sourceAgent: 'codex',
                sourceId: 'sample',
                sourcePath: '~/.codex/skills/sample',
            },
        });
    });
});
