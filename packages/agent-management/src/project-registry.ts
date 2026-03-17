import { existsSync, readFileSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';

export const ProjectRegistryEntrySchema = z
    .object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        configPath: z.string(),
        author: z.string().optional(),
        tags: z.array(z.string()).optional(),
        parentAgentId: z.string().optional(),
    })
    .strict();

export type ProjectRegistryEntry = z.output<typeof ProjectRegistryEntrySchema>;

export const ProjectRegistrySchema = z
    .object({
        primaryAgent: z.string().optional(),
        allowGlobalAgents: z.boolean().default(false),
        agents: z.array(ProjectRegistryEntrySchema),
    })
    .strict();

export type ProjectRegistry = z.output<typeof ProjectRegistrySchema>;

const PROJECT_REGISTRY_RELATIVE_PATHS = [
    path.join('agents', 'registry.json'),
    path.join('agents', 'agent-registry.json'),
] as const;

export function getProjectRegistryPath(projectRoot: string): string {
    return path.join(projectRoot, 'agents', 'registry.json');
}

export function getProjectRegistryCandidatePaths(projectRoot: string): string[] {
    return PROJECT_REGISTRY_RELATIVE_PATHS.map((relativePath) =>
        path.join(projectRoot, relativePath)
    );
}

export async function findProjectRegistryPath(projectRoot: string): Promise<string | null> {
    for (const registryPath of getProjectRegistryCandidatePaths(projectRoot)) {
        try {
            await fs.access(registryPath);
            return registryPath;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                continue;
            }
            throw error;
        }
    }

    return null;
}

export function findProjectRegistryPathSync(projectRoot: string): string | null {
    for (const registryPath of getProjectRegistryCandidatePaths(projectRoot)) {
        if (existsSync(registryPath)) {
            return registryPath;
        }
    }

    return null;
}

export async function readProjectRegistry(registryPath: string): Promise<ProjectRegistry> {
    const content = await fs.readFile(registryPath, 'utf-8');
    return ProjectRegistrySchema.parse(JSON.parse(content));
}

export function readProjectRegistrySync(registryPath: string): ProjectRegistry {
    const content = readFileSync(registryPath, 'utf-8');
    return ProjectRegistrySchema.parse(JSON.parse(content));
}

export async function loadProjectRegistry(
    projectRoot: string
): Promise<{ registryPath: string; registry: ProjectRegistry } | null> {
    const registryPath = await findProjectRegistryPath(projectRoot);
    if (!registryPath) {
        return null;
    }

    return {
        registryPath,
        registry: await readProjectRegistry(registryPath),
    };
}

export function loadProjectRegistrySync(
    projectRoot: string
): { registryPath: string; registry: ProjectRegistry } | null {
    const registryPath = findProjectRegistryPathSync(projectRoot);
    if (!registryPath) {
        return null;
    }

    return {
        registryPath,
        registry: readProjectRegistrySync(registryPath),
    };
}

export async function resolveProjectRegistryEntry(
    projectRoot: string,
    agentId: string
): Promise<{ registryPath: string; entry: ProjectRegistryEntry } | null> {
    const loaded = await loadProjectRegistry(projectRoot);
    if (!loaded) {
        return null;
    }

    const entry = loaded.registry.agents.find((agent) => agent.id === agentId);
    if (!entry) {
        return null;
    }

    return {
        registryPath: loaded.registryPath,
        entry,
    };
}

export function getDefaultProjectRegistryEntry(
    registry: ProjectRegistry,
    registryPath: string
): ProjectRegistryEntry | null {
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

export async function resolveProjectRegistryAgentPath(
    projectRoot: string,
    agentId: string
): Promise<string | null> {
    const resolved = await resolveProjectRegistryEntry(projectRoot, agentId);
    if (!resolved) {
        return null;
    }

    const configPath = path.resolve(path.dirname(resolved.registryPath), resolved.entry.configPath);
    await fs.access(configPath);
    return configPath;
}

export async function resolveDefaultProjectRegistryAgentPath(
    projectRoot: string
): Promise<string | null> {
    const loaded = await loadProjectRegistry(projectRoot);
    if (!loaded) {
        return null;
    }

    const entry = getDefaultProjectRegistryEntry(loaded.registry, loaded.registryPath);
    if (!entry) {
        return null;
    }

    const configPath = path.resolve(path.dirname(loaded.registryPath), entry.configPath);
    await fs.access(configPath);
    return configPath;
}
