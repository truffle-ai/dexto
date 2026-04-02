import { existsSync, readFileSync, statSync } from 'fs';
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';

const NonEmptyStringSchema = z.string().trim().min(1);

export const ProjectRegistryEntrySchema = z
    .object({
        id: NonEmptyStringSchema,
        name: NonEmptyStringSchema,
        description: NonEmptyStringSchema,
        configPath: NonEmptyStringSchema,
        author: NonEmptyStringSchema.optional(),
        tags: z.array(NonEmptyStringSchema).optional(),
        parentAgentId: NonEmptyStringSchema.optional(),
    })
    .strict();

export type ProjectRegistryEntry = z.output<typeof ProjectRegistryEntrySchema>;

export const ProjectRegistrySchema = z
    .object({
        primaryAgent: NonEmptyStringSchema.optional(),
        allowGlobalAgents: z.boolean().default(false),
        agents: z.array(ProjectRegistryEntrySchema),
    })
    .strict()
    .superRefine((registry, ctx) => {
        const seenIds = new Set<string>();
        for (const [index, agent] of registry.agents.entries()) {
            if (seenIds.has(agent.id)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['agents', index, 'id'],
                    message: `Duplicate agent id '${agent.id}'.`,
                });
                continue;
            }

            seenIds.add(agent.id);
        }

        if (
            registry.primaryAgent &&
            !registry.agents.some((agent) => agent.id === registry.primaryAgent)
        ) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['primaryAgent'],
                message: `Primary agent '${registry.primaryAgent}' must match an agent id in 'agents'.`,
            });
        }
    });

export type ProjectRegistry = z.output<typeof ProjectRegistrySchema>;

export type ProjectRegistryErrorCode =
    | 'PROJECT_REGISTRY_INVALID'
    | 'PROJECT_REGISTRY_INVALID_PRIMARY'
    | 'PROJECT_REGISTRY_INVALID_CONFIG_PATH';

export class ProjectRegistryError extends Error {
    readonly code: ProjectRegistryErrorCode;
    readonly registryPath: string;
    readonly agentId: string | undefined;
    readonly configPath: string | undefined;

    constructor(options: {
        code: ProjectRegistryErrorCode;
        message: string;
        registryPath: string;
        agentId?: string | undefined;
        configPath?: string | undefined;
        cause?: unknown;
    }) {
        super(options.message, options.cause ? { cause: options.cause } : undefined);
        this.name = 'ProjectRegistryError';
        this.code = options.code;
        this.registryPath = options.registryPath;
        this.agentId = options.agentId;
        this.configPath = options.configPath;
    }

    static invalidRegistry(registryPath: string, message: string, cause?: unknown) {
        return new ProjectRegistryError({
            code: 'PROJECT_REGISTRY_INVALID',
            message,
            registryPath,
            cause,
        });
    }

    static invalidPrimaryAgent(registryPath: string, primaryAgent: string) {
        return new ProjectRegistryError({
            code: 'PROJECT_REGISTRY_INVALID_PRIMARY',
            message: `Primary agent '${primaryAgent}' not found in ${registryPath}.`,
            registryPath,
            agentId: primaryAgent,
        });
    }

    static invalidConfigPath(options: {
        registryPath: string;
        agentId: string;
        configPath: string;
        reason: string;
    }) {
        return new ProjectRegistryError({
            code: 'PROJECT_REGISTRY_INVALID_CONFIG_PATH',
            message: `Agent '${options.agentId}' in ${options.registryPath} has invalid configPath '${options.configPath}': ${options.reason}.`,
            registryPath: options.registryPath,
            agentId: options.agentId,
            configPath: options.configPath,
        });
    }
}

export function isProjectRegistryError(error: unknown): error is ProjectRegistryError {
    return error instanceof ProjectRegistryError;
}

const PROJECT_REGISTRY_RELATIVE_PATHS = [
    path.join('agents', 'registry.json'),
    path.join('agents', 'agent-registry.json'),
] as const;

function isBundledAgentRegistryShape(parsed: unknown): boolean {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return false;
    }

    const candidate = parsed as {
        version?: unknown;
        agents?: unknown;
    };

    return (
        typeof candidate.version === 'string' &&
        candidate.agents !== null &&
        typeof candidate.agents === 'object' &&
        !Array.isArray(candidate.agents)
    );
}

async function shouldIgnoreProjectRegistryCandidate(registryPath: string): Promise<boolean> {
    if (path.basename(registryPath) !== 'agent-registry.json') {
        return false;
    }

    try {
        const content = await fs.readFile(registryPath, 'utf-8');
        return isBundledAgentRegistryShape(JSON.parse(content));
    } catch {
        return false;
    }
}

function shouldIgnoreProjectRegistryCandidateSync(registryPath: string): boolean {
    if (path.basename(registryPath) !== 'agent-registry.json') {
        return false;
    }

    try {
        return isBundledAgentRegistryShape(JSON.parse(readFileSync(registryPath, 'utf-8')));
    } catch {
        return false;
    }
}

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
            if ((await fs.stat(registryPath)).isFile()) {
                if (await shouldIgnoreProjectRegistryCandidate(registryPath)) {
                    continue;
                }
                return registryPath;
            }
        } catch (error) {
            if (
                (error as NodeJS.ErrnoException).code === 'ENOENT' ||
                (error as NodeJS.ErrnoException).code === 'ENOTDIR'
            ) {
                continue;
            }
            throw error;
        }
    }

    return null;
}

export function findProjectRegistryPathSync(projectRoot: string): string | null {
    for (const registryPath of getProjectRegistryCandidatePaths(projectRoot)) {
        try {
            if (existsSync(registryPath) && statSync(registryPath).isFile()) {
                if (shouldIgnoreProjectRegistryCandidateSync(registryPath)) {
                    continue;
                }
                return registryPath;
            }
        } catch (error) {
            if (
                (error as NodeJS.ErrnoException).code === 'EISDIR' ||
                (error as NodeJS.ErrnoException).code === 'ENOTDIR'
            ) {
                continue;
            }
            throw error;
        }
    }

    return null;
}

function parseProjectRegistryContent(content: string, registryPath: string): ProjectRegistry {
    let parsed: unknown;

    try {
        parsed = JSON.parse(content);
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw ProjectRegistryError.invalidRegistry(
                registryPath,
                `Invalid workspace registry at ${registryPath}: ${error.message}`,
                error
            );
        }
        throw error;
    }

    try {
        return ProjectRegistrySchema.parse(parsed);
    } catch (error) {
        if (error instanceof z.ZodError) {
            const rawPrimaryAgent =
                parsed &&
                typeof parsed === 'object' &&
                typeof (parsed as { primaryAgent?: unknown }).primaryAgent === 'string'
                    ? (parsed as { primaryAgent: string }).primaryAgent
                    : undefined;
            const hasPrimaryAgentIssue = error.issues.some(
                (issue) => issue.path[0] === 'primaryAgent'
            );

            if (hasPrimaryAgentIssue && rawPrimaryAgent) {
                throw ProjectRegistryError.invalidPrimaryAgent(registryPath, rawPrimaryAgent);
            }

            throw ProjectRegistryError.invalidRegistry(
                registryPath,
                `Invalid workspace registry at ${registryPath}: ${error.message}`,
                error
            );
        }

        throw error;
    }
}

export async function readProjectRegistry(registryPath: string): Promise<ProjectRegistry> {
    const content = await fs.readFile(registryPath, 'utf-8');
    return parseProjectRegistryContent(content, registryPath);
}

export function readProjectRegistrySync(registryPath: string): ProjectRegistry {
    return parseProjectRegistryContent(readFileSync(registryPath, 'utf-8'), registryPath);
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
            throw ProjectRegistryError.invalidPrimaryAgent(registryPath, registry.primaryAgent);
        }
        return primaryEntry;
    }

    if (registry.agents.length === 1) {
        return registry.agents[0] ?? null;
    }

    return null;
}

function assertProjectRegistryConfigPathSync(options: {
    projectRoot: string;
    registryPath: string;
    entry: ProjectRegistryEntry;
}): string {
    const absolutePath = path.resolve(path.dirname(options.registryPath), options.entry.configPath);
    const relativeToProject = path.relative(options.projectRoot, absolutePath);
    if (
        relativeToProject.startsWith('..') ||
        path.isAbsolute(relativeToProject) ||
        relativeToProject === ''
    ) {
        throw ProjectRegistryError.invalidConfigPath({
            registryPath: options.registryPath,
            agentId: options.entry.id,
            configPath: options.entry.configPath,
            reason: 'path must stay within the workspace root',
        });
    }

    let stat;
    try {
        stat = statSync(absolutePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw ProjectRegistryError.invalidConfigPath({
                registryPath: options.registryPath,
                agentId: options.entry.id,
                configPath: options.entry.configPath,
                reason: 'file does not exist',
            });
        }
        throw error;
    }

    if (!stat.isFile()) {
        throw ProjectRegistryError.invalidConfigPath({
            registryPath: options.registryPath,
            agentId: options.entry.id,
            configPath: options.entry.configPath,
            reason: 'path must point to a file',
        });
    }

    return absolutePath;
}

async function assertProjectRegistryConfigPath(options: {
    projectRoot: string;
    registryPath: string;
    entry: ProjectRegistryEntry;
}): Promise<string> {
    const absolutePath = path.resolve(path.dirname(options.registryPath), options.entry.configPath);
    const relativeToProject = path.relative(options.projectRoot, absolutePath);
    if (
        relativeToProject.startsWith('..') ||
        path.isAbsolute(relativeToProject) ||
        relativeToProject === ''
    ) {
        throw ProjectRegistryError.invalidConfigPath({
            registryPath: options.registryPath,
            agentId: options.entry.id,
            configPath: options.entry.configPath,
            reason: 'path must stay within the workspace root',
        });
    }

    let stat;
    try {
        stat = await fs.stat(absolutePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw ProjectRegistryError.invalidConfigPath({
                registryPath: options.registryPath,
                agentId: options.entry.id,
                configPath: options.entry.configPath,
                reason: 'file does not exist',
            });
        }
        throw error;
    }

    if (!stat.isFile()) {
        throw ProjectRegistryError.invalidConfigPath({
            registryPath: options.registryPath,
            agentId: options.entry.id,
            configPath: options.entry.configPath,
            reason: 'path must point to a file',
        });
    }

    return absolutePath;
}

export async function resolveProjectRegistryEntryConfigPath(
    projectRoot: string,
    registryPath: string,
    entry: ProjectRegistryEntry
): Promise<string> {
    return await assertProjectRegistryConfigPath({ projectRoot, registryPath, entry });
}

export function resolveProjectRegistryEntryConfigPathSync(
    projectRoot: string,
    registryPath: string,
    entry: ProjectRegistryEntry
): string {
    return assertProjectRegistryConfigPathSync({ projectRoot, registryPath, entry });
}

export async function resolveProjectRegistryAgentPath(
    projectRoot: string,
    agentId: string
): Promise<string | null> {
    const resolved = await resolveProjectRegistryEntry(projectRoot, agentId);
    if (!resolved) {
        return null;
    }

    return await resolveProjectRegistryEntryConfigPath(
        projectRoot,
        resolved.registryPath,
        resolved.entry
    );
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

    return await resolveProjectRegistryEntryConfigPath(projectRoot, loaded.registryPath, entry);
}
