import {
    findProjectRegistryPath,
    getDefaultProjectRegistryEntry,
    readProjectRegistry,
} from '@dexto/agent-management';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { normalizeWorkspaceRelativePath } from './config.js';

const PRIMARY_WORKSPACE_AGENT_PATHS = [
    path.join('agents', 'coding-agent', 'coding-agent.yml'),
    path.join('agents', 'coding-agent', 'coding-agent.yaml'),
    path.join('agents', 'coding-agent.yml'),
    path.join('agents', 'coding-agent.yaml'),
] as const;

async function loadWorkspaceProjectRegistry(
    workspaceRoot: string
): Promise<{ registryPath: string; defaultConfigPath: string } | null> {
    const registryPath = await findProjectRegistryPath(workspaceRoot);
    if (!registryPath) {
        return null;
    }

    const registry = await readProjectRegistry(registryPath);
    const defaultEntry = getDefaultProjectRegistryEntry(registry, registryPath);
    if (!defaultEntry) {
        return null;
    }

    return {
        registryPath,
        defaultConfigPath: await resolveWorkspaceRegistryConfigPath(
            workspaceRoot,
            registryPath,
            defaultEntry.configPath,
            defaultEntry.id
        ),
    };
}

async function resolveWorkspaceRegistryConfigPath(
    workspaceRoot: string,
    registryPath: string,
    configPath: string,
    agentId: string
): Promise<string> {
    const normalizedPath = normalizeWorkspaceRelativePath(configPath);
    const absolutePath = path.resolve(path.dirname(registryPath), normalizedPath);
    const relativeToWorkspace = path.relative(workspaceRoot, absolutePath);
    if (
        relativeToWorkspace.startsWith('..') ||
        path.isAbsolute(relativeToWorkspace) ||
        relativeToWorkspace === ''
    ) {
        throw new Error(
            `Agent '${agentId}' in ${registryPath} has invalid configPath '${configPath}': path must stay inside the workspace root.`
        );
    }

    let stat;
    try {
        stat = await fs.stat(absolutePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new Error(
                `Agent '${agentId}' in ${registryPath} has invalid configPath '${configPath}': file does not exist.`
            );
        }
        throw error;
    }

    if (!stat.isFile()) {
        throw new Error(
            `Agent '${agentId}' in ${registryPath} has invalid configPath '${configPath}': path must point to a file.`
        );
    }

    return absolutePath;
}

export function isAgentYamlPath(filePath: string): boolean {
    return /\.(ya?ml)$/i.test(filePath);
}

export async function discoverPrimaryWorkspaceAgent(workspaceRoot: string): Promise<string | null> {
    const loadedRegistry = await loadWorkspaceProjectRegistry(workspaceRoot);
    if (loadedRegistry) {
        return normalizeWorkspaceRelativePath(
            path.relative(workspaceRoot, loadedRegistry.defaultConfigPath).replace(/\\/g, '/')
        );
    }

    for (const relativePath of PRIMARY_WORKSPACE_AGENT_PATHS) {
        const absolutePath = path.join(workspaceRoot, relativePath);
        if (!existsSync(absolutePath)) {
            continue;
        }

        const stat = await fs.stat(absolutePath);
        if (!stat.isFile()) {
            continue;
        }

        return normalizeWorkspaceRelativePath(relativePath);
    }

    return null;
}
