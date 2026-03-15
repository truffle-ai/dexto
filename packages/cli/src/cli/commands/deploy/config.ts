import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';

export const DEPLOY_CONFIG_RELATIVE_PATH = path.join('.dexto', 'deploy.json');

export const DEFAULT_DEPLOY_EXCLUDES = [
    '.git',
    'node_modules',
    'dist',
    '.next',
    '.turbo',
    '.env*',
] as const;

export function normalizeWorkspaceRelativePath(value: string): string {
    const trimmed = value.trim().replace(/\\/g, '/');
    if (trimmed.length === 0) {
        throw new Error('Path must not be empty');
    }
    if (path.posix.isAbsolute(trimmed)) {
        throw new Error('Path must be relative to the workspace root');
    }

    const normalized = path.posix.normalize(trimmed);
    if (normalized === '.' || normalized.length === 0) {
        throw new Error('Path must point to a file inside the workspace');
    }
    if (normalized === '..' || normalized.startsWith('../')) {
        throw new Error('Path must stay inside the workspace');
    }

    return normalized;
}

const WorkspaceRelativePathSchema = z
    .string()
    .trim()
    .min(1)
    .transform((value, ctx) => {
        try {
            return normalizeWorkspaceRelativePath(value);
        } catch (error) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: error instanceof Error ? error.message : 'Invalid workspace-relative path',
            });
            return z.NEVER;
        }
    });

const CloudDefaultDeployAgentSchema = z
    .object({
        type: z.literal('cloud-default'),
    })
    .strict();

const WorkspaceDeployAgentSchema = z
    .object({
        type: z.literal('workspace'),
        path: WorkspaceRelativePathSchema.describe(
            'Repo-relative path to the agent YAML that should boot in cloud'
        ),
    })
    .strict();

export const DeployAgentSchema = z.discriminatedUnion('type', [
    CloudDefaultDeployAgentSchema,
    WorkspaceDeployAgentSchema,
]);

export const DeployConfigSchema = z
    .object({
        version: z.literal(1).default(1),
        agent: DeployAgentSchema,
        exclude: z.array(z.string().trim().min(1)).default([...DEFAULT_DEPLOY_EXCLUDES]),
    })
    .strict();

const LegacyDeployConfigSchema = z
    .object({
        version: z.literal(1).default(1),
        entryAgent: WorkspaceRelativePathSchema.describe(
            'Repo-relative path to the agent YAML that should boot in cloud'
        ),
        exclude: z.array(z.string().trim().min(1)).default([...DEFAULT_DEPLOY_EXCLUDES]),
    })
    .strict();

export type DeployConfig = z.output<typeof DeployConfigSchema>;
export type DeployConfigInput = z.input<typeof DeployConfigSchema>;
export type DeployAgent = z.output<typeof DeployAgentSchema>;
export type WorkspaceDeployAgent = z.output<typeof WorkspaceDeployAgentSchema>;

export function getDeployConfigPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, DEPLOY_CONFIG_RELATIVE_PATH);
}

export async function loadDeployConfig(workspaceRoot: string): Promise<DeployConfig | null> {
    const configPath = getDeployConfigPath(workspaceRoot);
    if (!existsSync(configPath)) {
        return null;
    }

    const raw = await fs.readFile(configPath, 'utf8');
    return parseDeployConfig(JSON.parse(raw));
}

export async function saveDeployConfig(
    workspaceRoot: string,
    config: DeployConfigInput
): Promise<DeployConfig> {
    const normalized = DeployConfigSchema.parse(config);
    const configPath = getDeployConfigPath(workspaceRoot);
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    return normalized;
}

function parseDeployConfig(value: unknown): DeployConfig {
    const parsed = DeployConfigSchema.safeParse(value);
    if (parsed.success) {
        return parsed.data;
    }

    const legacyParsed = LegacyDeployConfigSchema.safeParse(value);
    if (legacyParsed.success) {
        return createWorkspaceDeployConfig(legacyParsed.data.entryAgent, legacyParsed.data.exclude);
    }

    throw parsed.error;
}

export function createCloudDefaultDeployConfig(
    exclude: readonly string[] = DEFAULT_DEPLOY_EXCLUDES
): DeployConfig {
    return DeployConfigSchema.parse({
        version: 1,
        agent: {
            type: 'cloud-default',
        },
        exclude: [...exclude],
    });
}

export function createWorkspaceDeployConfig(
    agentPath: string,
    exclude: readonly string[] = DEFAULT_DEPLOY_EXCLUDES
): DeployConfig {
    return DeployConfigSchema.parse({
        version: 1,
        agent: {
            type: 'workspace',
            path: agentPath,
        },
        exclude: [...exclude],
    });
}

export function isWorkspaceDeployAgent(agent: DeployAgent): agent is WorkspaceDeployAgent {
    return agent.type === 'workspace';
}

export function resolveWorkspaceDeployAgentPath(workspaceRoot: string, agentPath: string): string {
    const normalizedAgentPath = normalizeWorkspaceRelativePath(agentPath);
    const resolvedPath = path.resolve(workspaceRoot, normalizedAgentPath);
    const relativeToWorkspace = path.relative(path.resolve(workspaceRoot), resolvedPath);
    if (
        relativeToWorkspace.length === 0 ||
        relativeToWorkspace === '..' ||
        relativeToWorkspace.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeToWorkspace)
    ) {
        throw new Error(`Workspace agent path must stay inside the workspace: ${agentPath}`);
    }
    return resolvedPath;
}
