import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { normalizeWorkspaceRelativePath } from './config.js';

const PROJECT_REGISTRY_RELATIVE_PATHS = [
    path.join('agents', 'registry.json'),
    path.join('agents', 'agent-registry.json'),
] as const;

const PRIMARY_WORKSPACE_AGENT_PATHS = [
    path.join('agents', 'coding-agent', 'coding-agent.yml'),
    path.join('agents', 'coding-agent', 'coding-agent.yaml'),
    path.join('agents', 'coding-agent.yml'),
    path.join('agents', 'coding-agent.yaml'),
] as const;

type WorkspaceProjectRegistryEntry = {
    id: string;
    configPath: string;
};

type WorkspaceProjectRegistry = {
    primaryAgent?: string | undefined;
    agents: WorkspaceProjectRegistryEntry[];
};

function isWorkspaceProjectRegistryEntry(value: unknown): value is WorkspaceProjectRegistryEntry {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const entry = value as Record<string, unknown>;
    return typeof entry.id === 'string' && typeof entry.configPath === 'string';
}

async function loadWorkspaceProjectRegistry(
    workspaceRoot: string
): Promise<{ registryPath: string; registry: WorkspaceProjectRegistry } | null> {
    for (const relativePath of PROJECT_REGISTRY_RELATIVE_PATHS) {
        const registryPath = path.join(workspaceRoot, relativePath);
        try {
            const content = await fs.readFile(registryPath, 'utf8');
            const parsed = JSON.parse(content) as Record<string, unknown>;
            if (
                !parsed ||
                typeof parsed !== 'object' ||
                !Array.isArray(parsed.agents) ||
                !parsed.agents.every(isWorkspaceProjectRegistryEntry)
            ) {
                throw new Error(
                    `Workspace registry at ${registryPath} must define an 'agents' array with valid entries.`
                );
            }

            if (parsed.primaryAgent !== undefined && typeof parsed.primaryAgent !== 'string') {
                throw new Error(
                    `Workspace registry at ${registryPath} must define primaryAgent as a string when present.`
                );
            }

            return {
                registryPath,
                registry: {
                    primaryAgent:
                        typeof parsed.primaryAgent === 'string' ? parsed.primaryAgent : undefined,
                    agents: parsed.agents,
                },
            };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                continue;
            }
            throw error;
        }
    }

    return null;
}

function getDefaultWorkspaceRegistryEntry(
    registry: WorkspaceProjectRegistry,
    registryPath: string
): WorkspaceProjectRegistryEntry | null {
    if (registry.primaryAgent) {
        const primaryEntry = registry.agents.find((agent) => agent.id === registry.primaryAgent);
        if (!primaryEntry) {
            throw new Error(
                `Primary agent '${registry.primaryAgent}' not found in ${registryPath}.`
            );
        }
        return primaryEntry;
    }

    if (registry.agents.length === 1) {
        return registry.agents[0] ?? null;
    }

    return null;
}

export function isAgentYamlPath(filePath: string): boolean {
    return /\.(ya?ml)$/i.test(filePath);
}

export async function discoverPrimaryWorkspaceAgent(workspaceRoot: string): Promise<string | null> {
    const loadedRegistry = await loadWorkspaceProjectRegistry(workspaceRoot);
    if (loadedRegistry) {
        const defaultEntry = getDefaultWorkspaceRegistryEntry(
            loadedRegistry.registry,
            loadedRegistry.registryPath
        );
        if (defaultEntry) {
            const normalizedPath = normalizeWorkspaceRelativePath(defaultEntry.configPath);
            const absolutePath = path.resolve(
                path.dirname(loadedRegistry.registryPath),
                normalizedPath
            );
            if (!existsSync(absolutePath)) {
                throw new Error(
                    `Primary workspace agent '${normalizedPath}' does not exist relative to ${path.relative(
                        workspaceRoot,
                        loadedRegistry.registryPath
                    )}.`
                );
            }
            return normalizeWorkspaceRelativePath(
                path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/')
            );
        }
    }

    for (const relativePath of PRIMARY_WORKSPACE_AGENT_PATHS) {
        const absolutePath = path.join(workspaceRoot, relativePath);
        if (!existsSync(absolutePath)) {
            continue;
        }

        return normalizeWorkspaceRelativePath(relativePath);
    }

    return null;
}
