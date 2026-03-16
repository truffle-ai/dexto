import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { setTimeout as delay } from 'timers/promises';
import { getDextoGlobalPath } from '@dexto/core';
import { z } from 'zod';

const DEPLOY_LINKS_FILENAME = 'links.json';
const DEPLOY_LOCK_SUFFIX = '.lock';
const DEPLOY_LOCK_RETRY_MS = 25;
const DEPLOY_LOCK_TIMEOUT_MS = 5_000;

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
        links: z.record(z.string(), DeployLinkSchema).default({}),
    })
    .strict();

export type DeployLink = z.output<typeof DeployLinkSchema>;
type DeployLinkInput = Pick<z.input<typeof DeployLinkSchema>, 'cloudAgentId' | 'agentUrl'>;
type DeployState = z.output<typeof DeployStateSchema>;

function getDeployLinksPath(): string {
    return getDextoGlobalPath('deployments', DEPLOY_LINKS_FILENAME);
}

function getDeployLockPath(filePath: string): string {
    return `${filePath}${DEPLOY_LOCK_SUFFIX}`;
}

function normalizeWorkspaceKey(workspaceRoot: string): string {
    return path.resolve(workspaceRoot);
}

async function loadDeployStateFromPath(filePath: string): Promise<DeployState> {
    if (!existsSync(filePath)) {
        return DeployStateSchema.parse({ version: 1, links: {} });
    }

    const raw = await fs.readFile(filePath, 'utf8');
    return DeployStateSchema.parse(JSON.parse(raw));
}

async function loadDeployState(): Promise<DeployState> {
    return loadDeployStateFromPath(getDeployLinksPath());
}

async function writeDeployStateAtomic(filePath: string, state: DeployState): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;

    try {
        await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        await fs.rename(tempPath, filePath);
    } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}

async function withDeployStateLock<T>(operation: (filePath: string) => Promise<T>): Promise<T> {
    const filePath = getDeployLinksPath();
    const lockPath = getDeployLockPath(filePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const deadline = Date.now() + DEPLOY_LOCK_TIMEOUT_MS;

    for (;;) {
        try {
            await fs.mkdir(lockPath);
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw error;
            }

            if (Date.now() >= deadline) {
                throw new Error(`Timed out waiting for deploy state lock: ${lockPath}`);
            }

            await delay(DEPLOY_LOCK_RETRY_MS);
        }
    }

    try {
        return await operation(filePath);
    } finally {
        await fs.rm(lockPath, { recursive: true, force: true });
    }
}

export async function loadWorkspaceDeployLink(workspaceRoot: string): Promise<DeployLink | null> {
    const state = await loadDeployState();
    return state.links[normalizeWorkspaceKey(workspaceRoot)] ?? null;
}

export async function saveWorkspaceDeployLink(
    workspaceRoot: string,
    link: DeployLinkInput
): Promise<void> {
    await withDeployStateLock(async (filePath) => {
        const state = await loadDeployStateFromPath(filePath);
        state.links[normalizeWorkspaceKey(workspaceRoot)] = DeployLinkSchema.parse({
            cloudAgentId: link.cloudAgentId,
            agentUrl: link.agentUrl,
            updatedAt: new Date().toISOString(),
        });
        await writeDeployStateAtomic(filePath, state);
    });
}

export async function removeWorkspaceDeployLink(workspaceRoot: string): Promise<void> {
    await withDeployStateLock(async (filePath) => {
        const state = await loadDeployStateFromPath(filePath);
        delete state.links[normalizeWorkspaceKey(workspaceRoot)];
        await writeDeployStateAtomic(filePath, state);
    });
}
