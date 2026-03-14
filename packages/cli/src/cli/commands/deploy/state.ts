import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { getDextoGlobalPath } from '@dexto/core';
import { z } from 'zod';

const DEPLOY_LINKS_FILENAME = 'links.json';

const DeployLinkSchema = z
    .object({
        cloudAgentId: z.string().trim().min(1),
        agentUrl: z.string().trim().min(1).optional(),
        updatedAt: z.string().datetime(),
    })
    .strict();

const DeployStateSchema = z
    .object({
        version: z.literal(1).default(1),
        links: z.record(DeployLinkSchema).default({}),
    })
    .strict();

export type DeployLink = z.output<typeof DeployLinkSchema>;
type DeployState = z.output<typeof DeployStateSchema>;

function getDeployLinksPath(): string {
    return getDextoGlobalPath('deployments', DEPLOY_LINKS_FILENAME);
}

function normalizeWorkspaceKey(workspaceRoot: string): string {
    return path.resolve(workspaceRoot);
}

async function loadDeployState(): Promise<DeployState> {
    const filePath = getDeployLinksPath();
    if (!existsSync(filePath)) {
        return DeployStateSchema.parse({ version: 1, links: {} });
    }

    const raw = await fs.readFile(filePath, 'utf8');
    return DeployStateSchema.parse(JSON.parse(raw));
}

async function saveDeployState(state: DeployState): Promise<void> {
    const filePath = getDeployLinksPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export async function loadWorkspaceDeployLink(workspaceRoot: string): Promise<DeployLink | null> {
    const state = await loadDeployState();
    return state.links[normalizeWorkspaceKey(workspaceRoot)] ?? null;
}

export async function saveWorkspaceDeployLink(
    workspaceRoot: string,
    link: Pick<DeployLink, 'cloudAgentId' | 'agentUrl'>
): Promise<void> {
    const state = await loadDeployState();
    state.links[normalizeWorkspaceKey(workspaceRoot)] = DeployLinkSchema.parse({
        cloudAgentId: link.cloudAgentId,
        agentUrl: link.agentUrl,
        updatedAt: new Date().toISOString(),
    });
    await saveDeployState(state);
}

export async function removeWorkspaceDeployLink(workspaceRoot: string): Promise<void> {
    const state = await loadDeployState();
    delete state.links[normalizeWorkspaceKey(workspaceRoot)];
    await saveDeployState(state);
}
