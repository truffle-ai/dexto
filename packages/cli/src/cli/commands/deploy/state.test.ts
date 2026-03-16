import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { stateRoot } = vi.hoisted(() => ({
    stateRoot: { current: '' },
}));

vi.mock('@dexto/core', () => ({
    getDextoGlobalPath: (type: string, filename?: string) => {
        const basePath = path.join(stateRoot.current, '.dexto', type);
        return filename ? path.join(basePath, filename) : basePath;
    },
}));

function createTempDir(): string {
    return fs.mkdtempSync(path.join(tmpdir(), 'dexto-deploy-state-'));
}

async function importStateModule() {
    return import('./state.js');
}

describe('deploy state', () => {
    beforeEach(() => {
        stateRoot.current = createTempDir();
        vi.resetModules();
    });

    afterEach(() => {
        if (stateRoot.current) {
            fs.rmSync(stateRoot.current, { recursive: true, force: true });
            stateRoot.current = '';
        }
        vi.resetModules();
    });

    it('saves and reloads a workspace deploy link', async () => {
        const { saveWorkspaceDeployLink, loadWorkspaceDeployLink } = await importStateModule();

        await saveWorkspaceDeployLink('/workspace/project-a', {
            cloudAgentId: 'cloud-agent-a',
            agentUrl: 'https://sandbox.dexto.ai/api/cloud-agents/cloud-agent-a/agent',
        });

        const link = await loadWorkspaceDeployLink('/workspace/project-a');
        expect(link).toMatchObject({
            cloudAgentId: 'cloud-agent-a',
            agentUrl: 'https://sandbox.dexto.ai/api/cloud-agents/cloud-agent-a/agent',
        });
        expect(link?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('removes a workspace deploy link', async () => {
        const { saveWorkspaceDeployLink, loadWorkspaceDeployLink, removeWorkspaceDeployLink } =
            await importStateModule();

        await saveWorkspaceDeployLink('/workspace/project-a', {
            cloudAgentId: 'cloud-agent-a',
            agentUrl: 'https://sandbox.dexto.ai/api/cloud-agents/cloud-agent-a/agent',
        });
        await removeWorkspaceDeployLink('/workspace/project-a');

        await expect(loadWorkspaceDeployLink('/workspace/project-a')).resolves.toBeNull();
    });

    it('preserves concurrent workspace link updates', async () => {
        const { saveWorkspaceDeployLink, loadWorkspaceDeployLink } = await importStateModule();

        await Promise.all([
            saveWorkspaceDeployLink('/workspace/project-a', {
                cloudAgentId: 'cloud-agent-a',
                agentUrl: 'https://sandbox.dexto.ai/api/cloud-agents/cloud-agent-a/agent',
            }),
            saveWorkspaceDeployLink('/workspace/project-b', {
                cloudAgentId: 'cloud-agent-b',
                agentUrl: 'https://sandbox.dexto.ai/api/cloud-agents/cloud-agent-b/agent',
            }),
        ]);

        await expect(loadWorkspaceDeployLink('/workspace/project-a')).resolves.toMatchObject({
            cloudAgentId: 'cloud-agent-a',
        });
        await expect(loadWorkspaceDeployLink('/workspace/project-b')).resolves.toMatchObject({
            cloudAgentId: 'cloud-agent-b',
        });
    });
});
