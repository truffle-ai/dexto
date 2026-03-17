import * as p from '@clack/prompts';
import type { AgentConfig } from '@dexto/agent-config';
import {
    deriveDisplayName,
    findProjectRegistryPath as findSharedProjectRegistryPath,
    getPrimaryApiKeyEnvVar,
    getProjectRegistryPath as getCanonicalProjectRegistryPath,
    ProjectRegistrySchema,
    readProjectRegistry as readSharedProjectRegistry,
    type ProjectRegistry as WorkspaceProjectRegistry,
    type ProjectRegistryEntry as WorkspaceProjectRegistryEntry,
    writeConfigFile,
} from '@dexto/agent-management';
import type { LLMProvider } from '@dexto/core';
import chalk from 'chalk';
import type { Command } from 'commander';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ExitSignal, safeExit, withAnalytics } from '../../analytics/wrapper.js';
import { getDeployConfigPath, isWorkspaceDeployAgent, loadDeployConfig } from './deploy/config.js';
import { discoverPrimaryWorkspaceAgent } from './deploy/entry-agent.js';
import { selectOrExit, textOrExit } from '../utils/prompt-helpers.js';

const AGENTS_FILENAME = 'AGENTS.md';
const WORKSPACE_DIRECTORIES = ['agents', 'skills'] as const;
const DEFAULT_AGENT_PROVIDER: LLMProvider = 'openai';
const DEFAULT_AGENT_MODEL = 'gpt-5.4-codex';
const DEFAULT_AGENT_VERSION = '0.1.0';

const DEFAULT_AGENTS_MD = `<!-- dexto-workspace -->

# Dexto Workspace

This workspace can define project-specific agents and skills.

## Structure
- Put custom agents and subagents in \`agents/\`
- Put custom skills in \`skills/<skill-id>/SKILL.md\`
- Use \`.dexto/\` only for Dexto-managed state and installed assets

## Defaults
- If no workspace agent is defined, Dexto uses your global default agent locally
- Cloud deploys without a workspace agent use the managed cloud default agent
`;

type ScaffoldEntryStatus = 'created' | 'existing';
type RegistryUpdateStatus = 'created' | 'existing' | 'updated';

export interface WorkspaceScaffoldResult {
    root: string;
    agentsFile: { path: string; status: ScaffoldEntryStatus };
    directories: Array<{ path: string; status: ScaffoldEntryStatus }>;
}

export interface WorkspaceAgentScaffoldResult {
    workspace: WorkspaceScaffoldResult;
    registry: { path: string; status: RegistryUpdateStatus };
    agentConfig: { path: string; status: ScaffoldEntryStatus };
    primaryAgent: { id: string | null; status: 'set' | 'unchanged' };
}

export interface WorkspaceSkillScaffoldResult {
    workspace: WorkspaceScaffoldResult;
    skillFile: { path: string; status: ScaffoldEntryStatus };
}

export interface WorkspacePrimaryAgentResult {
    workspace: WorkspaceScaffoldResult;
    registry: { path: string; status: Exclude<RegistryUpdateStatus, 'created'> };
    primaryAgent: { id: string; status: 'set' | 'existing' };
}

export interface WorkspaceSubagentLinkResult {
    workspace: WorkspaceScaffoldResult;
    registry: { path: string; status: 'updated' | 'existing' };
    subagentId: string;
    parentAgentId: string | null;
    status: 'set' | 'existing' | 'no-primary';
}

export interface WorkspaceStatusResult {
    workspaceRoot: string;
    agentsFilePresent: boolean;
    agentsDirectoryPresent: boolean;
    skillsDirectoryPresent: boolean;
    registryPath: string | null;
    primaryAgentId: string | null;
    allowGlobalAgents: boolean | null;
    agents: Array<{
        id: string;
        isPrimary: boolean;
        isSubagent: boolean;
        parentAgentId: string | null;
    }>;
    skills: string[];
    deployConfigPath: string | null;
    effectiveDeploySummary: string;
}

export interface InitCommandRegisterContext {
    program: Command;
}

type InitAgentCommandOptions = {
    subagent?: boolean;
    primary?: boolean;
};

type InitialAgentLlmConfig = {
    provider: LLMProvider;
    model: string;
    apiKey: string;
};

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isSubagentEntry(entry: WorkspaceProjectRegistryEntry): boolean {
    return (entry.tags?.includes('subagent') ?? false) || Boolean(entry.parentAgentId);
}

function isPrimaryCandidate(entry: WorkspaceProjectRegistryEntry): boolean {
    return !isSubagentEntry(entry);
}

function getEffectiveWorkspacePrimaryAgentId(registry: WorkspaceProjectRegistry): string | null {
    if (registry.primaryAgent) {
        return registry.primaryAgent;
    }

    const candidates = registry.agents.filter(isPrimaryCandidate);
    if (candidates.length === 1) {
        return candidates[0]?.id ?? null;
    }

    return null;
}

function getWorkspaceAgentEntry(
    registry: WorkspaceProjectRegistry,
    agentId: string
): WorkspaceProjectRegistryEntry | null {
    return registry.agents.find((entry) => entry.id === agentId) ?? null;
}

async function ensureWorkspaceRoot(root: string): Promise<void> {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
        throw new Error(`${root} exists and is not a directory`);
    }
}

async function getExistingEntryType(entryPath: string): Promise<'missing' | 'file' | 'directory'> {
    try {
        const stat = await fs.stat(entryPath);
        if (stat.isDirectory()) {
            return 'directory';
        }
        if (stat.isFile()) {
            return 'file';
        }
        return 'file';
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return 'missing';
        }
        throw error;
    }
}

function normalizeScaffoldId(id: string, kind: 'agent' | 'skill'): string {
    const normalized = id.trim();
    if (!ID_PATTERN.test(normalized)) {
        throw new Error(
            `Invalid ${kind} id '${id}'. Use kebab-case like '${kind === 'agent' ? 'coding-agent' : 'code-review'}'.`
        );
    }
    return normalized;
}

async function ensureDirectory(dirPath: string): Promise<ScaffoldEntryStatus> {
    try {
        const stat = await fs.stat(dirPath);
        if (!stat.isDirectory()) {
            throw new Error(`${dirPath} exists and is not a directory`);
        }
        return 'existing';
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }

    await fs.mkdir(dirPath, { recursive: true });
    return 'created';
}

async function ensureFile(filePath: string, content: string): Promise<ScaffoldEntryStatus> {
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
            throw new Error(`${filePath} exists and is not a file`);
        }
        return 'existing';
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }

    await fs.writeFile(filePath, content, 'utf-8');
    return 'created';
}

async function loadInitialAgentLlmConfig(): Promise<InitialAgentLlmConfig> {
    return {
        provider: DEFAULT_AGENT_PROVIDER,
        model: DEFAULT_AGENT_MODEL,
        apiKey: `$${getPrimaryApiKeyEnvVar(DEFAULT_AGENT_PROVIDER)}`,
    };
}

function buildAgentDescription(agentId: string, options: InitAgentCommandOptions): string {
    if (options.subagent) {
        return `Workspace sub-agent '${agentId}' for delegated tasks.`;
    }

    if (agentId === 'coding-agent') {
        return 'Primary workspace agent for this project.';
    }

    return `Workspace agent '${agentId}' for this project.`;
}

async function buildAgentConfig(
    agentId: string,
    options: InitAgentCommandOptions
): Promise<AgentConfig> {
    const llmConfig = await loadInitialAgentLlmConfig();
    const displayName = deriveDisplayName(agentId);
    const description = buildAgentDescription(agentId, options);

    const llm: AgentConfig['llm'] = {
        provider: llmConfig.provider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
    };

    return {
        image: '@dexto/image-local',
        agentId,
        agentCard: {
            name: displayName,
            description,
            url: `https://example.com/agents/${agentId}`,
            version: DEFAULT_AGENT_VERSION,
        },
        systemPrompt: options.subagent
            ? [
                  `You are ${displayName}, a specialized sub-agent for this workspace.`,
                  '',
                  'Complete delegated tasks efficiently and concisely.',
                  'Read the relevant files before responding.',
                  'Return a clear result to the parent agent with concrete findings or next steps.',
              ].join('\n')
            : [
                  `You are ${displayName}, the workspace agent for this project.`,
                  '',
                  'Help the user understand, edit, run, and deploy the files in this workspace.',
                  'Read relevant files before making changes.',
                  'Keep changes focused and explain what changed.',
              ].join('\n'),
        greeting: options.subagent
            ? `Ready to help as ${displayName}.`
            : 'Ready to work in this workspace.',
        llm,
        permissions: {
            mode: 'manual',
            allowedToolsStorage: 'storage',
        },
    };
}

function buildRegistryEntry(
    agentId: string,
    options: InitAgentCommandOptions
): WorkspaceProjectRegistryEntry {
    const description = buildAgentDescription(agentId, options);
    return {
        id: agentId,
        name: deriveDisplayName(agentId),
        description,
        configPath: `./${agentId}/${agentId}.yml`,
        ...(options.subagent ? { tags: ['subagent'] } : {}),
    };
}

function addSubagentTag(entry: WorkspaceProjectRegistryEntry): WorkspaceProjectRegistryEntry {
    const tags = new Set(entry.tags ?? []);
    tags.add('subagent');
    return {
        ...entry,
        tags: Array.from(tags).sort(),
    };
}

function validateInitAgentOptions(options: InitAgentCommandOptions): void {
    if (options.primary && options.subagent) {
        throw new Error('A sub-agent cannot also be the primary workspace agent.');
    }
}

async function promptForAgentId(kind: 'primary' | 'agent' | 'subagent'): Promise<string> {
    const placeholder =
        kind === 'subagent'
            ? 'explore-agent'
            : kind === 'primary'
              ? 'review-agent'
              : 'helper-agent';

    return await textOrExit(
        {
            message: 'Agent id',
            placeholder,
            validate(value) {
                try {
                    normalizeScaffoldId(value, 'agent');
                    return undefined;
                } catch (error) {
                    return error instanceof Error ? error.message : 'Invalid agent id';
                }
            },
        },
        'Agent initialization cancelled'
    );
}

async function resolveInitAgentInput(
    agentIdInput: string | undefined,
    options: InitAgentCommandOptions,
    workspaceRoot: string
): Promise<{ agentId: string; options: InitAgentCommandOptions }> {
    validateInitAgentOptions(options);

    if (agentIdInput) {
        return {
            agentId: normalizeScaffoldId(agentIdInput, 'agent'),
            options,
        };
    }

    if (options.subagent || options.primary) {
        const kind = options.subagent ? 'subagent' : 'primary';
        return {
            agentId: normalizeScaffoldId(await promptForAgentId(kind), 'agent'),
            options,
        };
    }

    const registryState = await loadWorkspaceProjectRegistry(path.resolve(workspaceRoot));
    const currentPrimaryAgentId = getEffectiveWorkspacePrimaryAgentId(registryState.registry);

    const kind = await selectOrExit<'primary' | 'agent' | 'subagent'>(
        {
            message: 'What kind of agent do you want to create?',
            initialValue: currentPrimaryAgentId ? 'agent' : 'primary',
            options: [
                {
                    value: 'primary',
                    label: 'Primary agent',
                    hint: currentPrimaryAgentId
                        ? `Replace current primary (${currentPrimaryAgentId})`
                        : 'Main workspace agent used by default',
                },
                {
                    value: 'agent',
                    label: 'Additional agent',
                    hint: 'Workspace agent that is available but not the default',
                },
                {
                    value: 'subagent',
                    label: 'Subagent',
                    hint: 'Delegated helper agent for the primary workspace agent',
                },
            ],
        },
        'Agent initialization cancelled'
    );

    const resolvedOptions: InitAgentCommandOptions =
        kind === 'primary' ? { primary: true } : kind === 'subagent' ? { subagent: true } : {};

    return {
        agentId: normalizeScaffoldId(await promptForAgentId(kind), 'agent'),
        options: resolvedOptions,
    };
}

function buildSkillTemplate(skillId: string): string {
    const displayName = deriveDisplayName(skillId);
    return `---
name: "${skillId}"
description: "TODO: Describe when to use this skill."
---

# ${displayName}

## Purpose
Describe what this skill helps the agent accomplish.

## Inputs
- The task or context that should trigger this skill
- Relevant files, paths, or constraints

## Steps
1. Review the relevant context.
2. Apply the workflow for this skill.
3. Return a concise result with any important follow-up actions.

## Output Format
- Summary of what was found or changed
- Key decisions or recommendations
- Follow-up actions, if any
`;
}

async function loadWorkspaceProjectRegistry(workspaceRoot: string): Promise<{
    path: string;
    registry: WorkspaceProjectRegistry;
    status: Exclude<RegistryUpdateStatus, 'updated'>;
}> {
    const existingPath = await findSharedProjectRegistryPath(workspaceRoot);
    if (!existingPath) {
        return {
            path: getCanonicalProjectRegistryPath(workspaceRoot),
            registry: { allowGlobalAgents: false, agents: [] },
            status: 'created',
        };
    }

    return {
        path: existingPath,
        registry: await readSharedProjectRegistry(existingPath),
        status: 'existing',
    };
}

async function saveWorkspaceProjectRegistry(
    registryPath: string,
    registry: WorkspaceProjectRegistry
): Promise<void> {
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    const validatedRegistry = ProjectRegistrySchema.parse(registry);
    await fs.writeFile(registryPath, `${JSON.stringify(validatedRegistry, null, 2)}\n`, 'utf8');
}

export async function createWorkspaceScaffold(
    workspaceRoot: string = process.cwd()
): Promise<WorkspaceScaffoldResult> {
    const root = path.resolve(workspaceRoot);
    const agentsFilePath = path.join(root, AGENTS_FILENAME);
    await ensureWorkspaceRoot(root);

    const agentsFileType = await getExistingEntryType(agentsFilePath);
    if (agentsFileType === 'directory') {
        throw new Error(`${agentsFilePath} exists and is not a file`);
    }

    for (const directory of WORKSPACE_DIRECTORIES) {
        const dirPath = path.join(root, directory);
        const entryType = await getExistingEntryType(dirPath);
        if (entryType === 'file') {
            throw new Error(`${dirPath} exists and is not a directory`);
        }
    }

    const agentsFileStatus = await ensureFile(agentsFilePath, DEFAULT_AGENTS_MD);

    const directories: WorkspaceScaffoldResult['directories'] = [];
    for (const directory of WORKSPACE_DIRECTORIES) {
        const dirPath = path.join(root, directory);
        const status = await ensureDirectory(dirPath);
        directories.push({ path: dirPath, status });
    }

    return {
        root,
        agentsFile: { path: agentsFilePath, status: agentsFileStatus },
        directories,
    };
}

export async function createWorkspaceAgentScaffold(
    agentIdInput: string,
    options: InitAgentCommandOptions = {},
    workspaceRoot: string = process.cwd()
): Promise<WorkspaceAgentScaffoldResult> {
    validateInitAgentOptions(options);
    const agentId = normalizeScaffoldId(agentIdInput, 'agent');
    const workspace = await createWorkspaceScaffold(workspaceRoot);
    const agentDirPath = path.join(workspace.root, 'agents', agentId);
    const agentConfigPath = path.join(agentDirPath, `${agentId}.yml`);

    const registryState = await loadWorkspaceProjectRegistry(workspace.root);
    const existingEntry = registryState.registry.agents.find((entry) => entry.id === agentId);
    const expectedRegistryEntry = buildRegistryEntry(agentId, options);
    const currentPrimaryAgentId = getEffectiveWorkspacePrimaryAgentId(registryState.registry);

    if (existingEntry && existingEntry.configPath !== expectedRegistryEntry.configPath) {
        throw new Error(
            `Agent '${agentId}' already exists in ${registryState.path} with configPath '${existingEntry.configPath}'.`
        );
    }

    await ensureDirectory(agentDirPath);

    let agentConfigStatus: ScaffoldEntryStatus;
    const agentConfigEntryType = await getExistingEntryType(agentConfigPath);
    if (agentConfigEntryType === 'directory') {
        throw new Error(`${agentConfigPath} exists and is not a file`);
    }

    if (agentConfigEntryType === 'file') {
        agentConfigStatus = 'existing';
    } else {
        const config = await buildAgentConfig(agentId, options);
        await writeConfigFile(agentConfigPath, config);
        agentConfigStatus = 'created';
    }

    if (existingEntry) {
        let registryUpdated = false;

        if (options.subagent && !isSubagentEntry(existingEntry)) {
            if (currentPrimaryAgentId === agentId) {
                throw new Error(
                    `Agent '${agentId}' is currently the workspace primary agent. Set another primary agent before converting it to a subagent.`
                );
            }

            registryState.registry.agents = registryState.registry.agents.map((entry) =>
                entry.id === agentId ? addSubagentTag(entry) : entry
            );
            registryUpdated = true;
        }

        let primaryAgentStatus: 'set' | 'unchanged' = 'unchanged';
        if (options.primary && registryState.registry.primaryAgent !== agentId) {
            const updatedEntry = getWorkspaceAgentEntry(registryState.registry, agentId);
            if (!updatedEntry || !isPrimaryCandidate(updatedEntry)) {
                throw new Error(
                    `Agent '${agentId}' is marked as a subagent and cannot be selected as the workspace primary agent.`
                );
            }

            registryState.registry.primaryAgent = agentId;
            primaryAgentStatus = 'set';
            registryUpdated = true;
        }

        if (registryUpdated) {
            await saveWorkspaceProjectRegistry(registryState.path, registryState.registry);
        }

        return {
            workspace,
            registry: {
                path: registryState.path,
                status: registryUpdated ? 'updated' : registryState.status,
            },
            agentConfig: { path: agentConfigPath, status: agentConfigStatus },
            primaryAgent: {
                id: getEffectiveWorkspacePrimaryAgentId(registryState.registry),
                status: primaryAgentStatus,
            },
        };
    }

    registryState.registry.agents.push(expectedRegistryEntry);
    registryState.registry.agents.sort((left, right) => left.id.localeCompare(right.id));
    const primaryCandidatesAfterAdd = registryState.registry.agents.filter(isPrimaryCandidate);

    let primaryAgentStatus: 'set' | 'unchanged' = 'unchanged';
    if (
        !options.subagent &&
        (options.primary || (!currentPrimaryAgentId && primaryCandidatesAfterAdd.length === 1)) &&
        registryState.registry.primaryAgent !== agentId
    ) {
        registryState.registry.primaryAgent = agentId;
        primaryAgentStatus = 'set';
    }

    await saveWorkspaceProjectRegistry(registryState.path, registryState.registry);

    return {
        workspace,
        registry: {
            path: registryState.path,
            status: registryState.status === 'created' ? 'created' : 'updated',
        },
        agentConfig: { path: agentConfigPath, status: agentConfigStatus },
        primaryAgent: {
            id: getEffectiveWorkspacePrimaryAgentId(registryState.registry),
            status: primaryAgentStatus,
        },
    };
}

export async function createWorkspaceSkillScaffold(
    skillIdInput: string,
    workspaceRoot: string = process.cwd()
): Promise<WorkspaceSkillScaffoldResult> {
    const skillId = normalizeScaffoldId(skillIdInput, 'skill');
    const workspace = await createWorkspaceScaffold(workspaceRoot);
    const skillDirPath = path.join(workspace.root, 'skills', skillId);
    const skillFilePath = path.join(skillDirPath, 'SKILL.md');

    await ensureDirectory(skillDirPath);
    const skillFileStatus = await ensureFile(skillFilePath, buildSkillTemplate(skillId));

    return {
        workspace,
        skillFile: {
            path: skillFilePath,
            status: skillFileStatus,
        },
    };
}

export async function setWorkspacePrimaryAgent(
    agentIdInput: string,
    workspaceRoot: string = process.cwd()
): Promise<WorkspacePrimaryAgentResult> {
    const agentId = normalizeScaffoldId(agentIdInput, 'agent');
    const workspace = await createWorkspaceScaffold(workspaceRoot);
    const registryState = await loadWorkspaceProjectRegistry(workspace.root);
    const existingEntry = registryState.registry.agents.find((entry) => entry.id === agentId);

    if (!existingEntry) {
        throw new Error(
            `Agent '${agentId}' is not registered in ${path.relative(
                workspace.root,
                registryState.path
            )}. Run \`dexto init agent ${agentId}\` first or update the registry manually.`
        );
    }

    if (!isPrimaryCandidate(existingEntry)) {
        throw new Error(
            `Agent '${agentId}' is marked as a subagent and cannot be selected as the workspace primary agent.`
        );
    }

    if (registryState.registry.primaryAgent === agentId) {
        return {
            workspace,
            registry: { path: registryState.path, status: 'existing' },
            primaryAgent: { id: agentId, status: 'existing' },
        };
    }

    registryState.registry.primaryAgent = agentId;
    await saveWorkspaceProjectRegistry(registryState.path, registryState.registry);

    return {
        workspace,
        registry: { path: registryState.path, status: 'updated' },
        primaryAgent: { id: agentId, status: 'set' },
    };
}

export async function linkWorkspaceSubagentToPrimaryAgent(
    subagentIdInput: string,
    workspaceRoot: string = process.cwd()
): Promise<WorkspaceSubagentLinkResult> {
    const subagentId = normalizeScaffoldId(subagentIdInput, 'agent');
    const workspace = await createWorkspaceScaffold(workspaceRoot);
    const registryState = await loadWorkspaceProjectRegistry(workspace.root);
    const subagentEntry = getWorkspaceAgentEntry(registryState.registry, subagentId);

    if (!subagentEntry) {
        throw new Error(
            `Agent '${subagentId}' is not registered in ${path.relative(
                workspace.root,
                registryState.path
            )}.`
        );
    }

    const primaryAgentId = getEffectiveWorkspacePrimaryAgentId(registryState.registry);
    if (!primaryAgentId || primaryAgentId === subagentId) {
        return {
            workspace,
            registry: { path: registryState.path, status: 'existing' },
            subagentId,
            parentAgentId: primaryAgentId,
            status: 'no-primary',
        };
    }

    const needsSubagentTag = !isSubagentEntry(subagentEntry);
    if (subagentEntry.parentAgentId === primaryAgentId && !needsSubagentTag) {
        return {
            workspace,
            registry: { path: registryState.path, status: 'existing' },
            subagentId,
            parentAgentId: primaryAgentId,
            status: 'existing',
        };
    }

    registryState.registry.agents = registryState.registry.agents.map((entry) =>
        entry.id === subagentId
            ? { ...addSubagentTag(entry), parentAgentId: primaryAgentId }
            : entry
    );
    await saveWorkspaceProjectRegistry(registryState.path, registryState.registry);

    return {
        workspace,
        registry: { path: registryState.path, status: 'updated' },
        subagentId,
        parentAgentId: primaryAgentId,
        status: 'set',
    };
}

function formatCreatedPaths(result: WorkspaceScaffoldResult): string[] {
    const createdPaths: string[] = [];

    if (result.agentsFile.status === 'created') {
        createdPaths.push(path.relative(result.root, result.agentsFile.path) || AGENTS_FILENAME);
    }

    for (const directory of result.directories) {
        if (directory.status === 'created') {
            createdPaths.push(
                path.relative(result.root, directory.path) || path.basename(directory.path)
            );
        }
    }

    return createdPaths;
}

function formatAgentPaths(result: WorkspaceAgentScaffoldResult): string[] {
    const createdPaths = formatCreatedPaths(result.workspace);

    if (result.registry.status === 'created' || result.registry.status === 'updated') {
        createdPaths.push(path.relative(result.workspace.root, result.registry.path));
    }

    if (result.agentConfig.status === 'created') {
        createdPaths.push(path.relative(result.workspace.root, result.agentConfig.path));
    }

    return createdPaths;
}

function formatSkillPaths(result: WorkspaceSkillScaffoldResult): string[] {
    const createdPaths = formatCreatedPaths(result.workspace);

    if (result.skillFile.status === 'created') {
        createdPaths.push(path.relative(result.workspace.root, result.skillFile.path));
    }

    return createdPaths;
}

async function listWorkspaceSkillIds(workspaceRoot: string): Promise<string[]> {
    const skillsRoot = path.join(workspaceRoot, 'skills');

    try {
        const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
        const skillIds: string[] = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const skillFilePath = path.join(skillsRoot, entry.name, 'SKILL.md');
            try {
                const stat = await fs.stat(skillFilePath);
                if (stat.isFile()) {
                    skillIds.push(entry.name);
                }
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    continue;
                }
                throw error;
            }
        }

        return skillIds.sort((left, right) => left.localeCompare(right));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }
}

function describeEffectiveDeployAgent(input: {
    deployConfigPath: string | null;
    deployConfig: Awaited<ReturnType<typeof loadDeployConfig>>;
    implicitWorkspaceAgent: string | null;
}): string {
    if (input.deployConfig) {
        const configuredAgent = isWorkspaceDeployAgent(input.deployConfig.agent)
            ? `workspace agent (${input.deployConfig.agent.path})`
            : 'default cloud agent';
        return `${configuredAgent} via ${input.deployConfigPath ?? '.dexto/deploy.json'}`;
    }

    if (input.implicitWorkspaceAgent) {
        return `workspace agent (${input.implicitWorkspaceAgent}) if you run \`dexto deploy\``;
    }

    return 'default cloud agent if you run `dexto deploy`';
}

export async function inspectWorkspaceStatus(
    workspaceRoot: string = process.cwd()
): Promise<WorkspaceStatusResult> {
    const root = path.resolve(workspaceRoot);
    await ensureWorkspaceRoot(root);

    const agentsFilePresent =
        (await getExistingEntryType(path.join(root, AGENTS_FILENAME))) === 'file';
    const agentsDirectoryPresent =
        (await getExistingEntryType(path.join(root, 'agents'))) === 'directory';
    const skillsDirectoryPresent =
        (await getExistingEntryType(path.join(root, 'skills'))) === 'directory';

    const registryPath = await findSharedProjectRegistryPath(root);
    const registry = registryPath ? await readSharedProjectRegistry(registryPath) : null;
    const primaryAgentId = registry ? getEffectiveWorkspacePrimaryAgentId(registry) : null;
    const agents =
        registry?.agents
            .map((entry) => ({
                id: entry.id,
                isPrimary: primaryAgentId === entry.id,
                isSubagent: isSubagentEntry(entry),
                parentAgentId: entry.parentAgentId ?? null,
            }))
            .sort((left, right) => left.id.localeCompare(right.id)) ?? [];
    const skills = await listWorkspaceSkillIds(root);

    const deployConfigPath = getDeployConfigPath(root);
    const deployConfig = await loadDeployConfig(root);
    const implicitWorkspaceAgent = await discoverPrimaryWorkspaceAgent(root);

    return {
        workspaceRoot: root,
        agentsFilePresent,
        agentsDirectoryPresent,
        skillsDirectoryPresent,
        registryPath,
        primaryAgentId,
        allowGlobalAgents: registry ? registry.allowGlobalAgents : null,
        agents,
        skills,
        deployConfigPath: deployConfig ? deployConfigPath : null,
        effectiveDeploySummary: describeEffectiveDeployAgent({
            deployConfigPath: deployConfig ? deployConfigPath : null,
            deployConfig,
            implicitWorkspaceAgent,
        }),
    };
}

function formatWorkspaceStatus(result: WorkspaceStatusResult): string {
    return [
        `Workspace: ${result.workspaceRoot}`,
        `AGENTS.md: ${result.agentsFilePresent ? 'present' : 'missing'}`,
        `agents/: ${result.agentsDirectoryPresent ? 'present' : 'missing'}`,
        `skills/: ${result.skillsDirectoryPresent ? 'present' : 'missing'}`,
        `Registry: ${result.registryPath ? path.relative(result.workspaceRoot, result.registryPath) : 'none'}`,
        `Primary agent: ${result.primaryAgentId ?? 'none (global default used locally)'}`,
        `Allow global agents: ${
            result.allowGlobalAgents === null
                ? 'n/a (no workspace registry)'
                : String(result.allowGlobalAgents)
        }`,
        `Deploy: ${result.effectiveDeploySummary}`,
        '',
        'Agents:',
        ...(result.agents.length > 0
            ? result.agents.map((agent) => {
                  const details = [
                      agent.isPrimary ? 'primary' : null,
                      agent.isSubagent ? 'subagent' : null,
                      agent.parentAgentId ? `parent: ${agent.parentAgentId}` : null,
                  ].filter(Boolean);
                  return `- ${agent.id}${details.length > 0 ? ` (${details.join(', ')})` : ''}`;
              })
            : ['- none']),
        '',
        'Skills:',
        ...(result.skills.length > 0 ? result.skills.map((skillId) => `- ${skillId}`) : ['- none']),
    ].join('\n');
}

async function resolvePrimaryAgentSelection(
    agentIdInput: string | undefined,
    workspaceRoot: string
): Promise<string> {
    if (agentIdInput) {
        return normalizeScaffoldId(agentIdInput, 'agent');
    }

    const workspace = await createWorkspaceScaffold(workspaceRoot);
    const registryState = await loadWorkspaceProjectRegistry(workspace.root);
    const primaryCandidates = registryState.registry.agents.filter(isPrimaryCandidate);

    if (primaryCandidates.length === 0) {
        throw new Error('No primary-capable workspace agents found. Run `dexto init agent` first.');
    }

    if (primaryCandidates.length === 1) {
        return primaryCandidates[0]?.id ?? '';
    }

    const currentPrimaryAgentId = getEffectiveWorkspacePrimaryAgentId(registryState.registry);
    const initialValue = primaryCandidates.some((entry) => entry.id === currentPrimaryAgentId)
        ? currentPrimaryAgentId
        : undefined;

    return await selectOrExit<string>(
        {
            message: 'Which agent should be the workspace primary?',
            initialValue,
            options: primaryCandidates.map((entry) => ({
                value: entry.id,
                label: `${entry.name} (${entry.id})`,
                hint:
                    registryState.registry.primaryAgent === entry.id
                        ? 'Current primary'
                        : entry.description,
            })),
        },
        'Primary agent selection cancelled'
    );
}

export async function handleInitCommand(workspaceRoot: string = process.cwd()): Promise<void> {
    p.intro(chalk.inverse('Dexto Init'));

    const result = await createWorkspaceScaffold(workspaceRoot);
    const createdPaths = formatCreatedPaths(result);

    if (createdPaths.length === 0) {
        p.outro(chalk.green('Workspace already initialized.'));
        return;
    }

    p.note(createdPaths.map((item) => `- ${item}`).join('\n'), 'Created');
    p.outro(chalk.green('Workspace initialized.'));
}

export async function handleInitAgentCommand(
    agentIdInput: string | undefined,
    options: InitAgentCommandOptions = {},
    workspaceRoot: string = process.cwd()
): Promise<void> {
    p.intro(chalk.inverse('Dexto Init Agent'));

    const resolved = await resolveInitAgentInput(agentIdInput, options, workspaceRoot);
    const result = await createWorkspaceAgentScaffold(
        resolved.agentId,
        resolved.options,
        workspaceRoot
    );
    const subagentLinkResult = resolved.options.subagent
        ? await linkWorkspaceSubagentToPrimaryAgent(resolved.agentId, workspaceRoot)
        : null;
    const createdPaths = formatAgentPaths(result);

    if (createdPaths.length === 0) {
        p.outro(
            chalk.green(
                [
                    `Agent '${resolved.agentId}' already initialized.`,
                    ...(subagentLinkResult?.status === 'set' && subagentLinkResult.parentAgentId
                        ? [`Linked to primary agent: ${subagentLinkResult.parentAgentId}`]
                        : subagentLinkResult?.status === 'no-primary'
                          ? ['No primary agent found to link this subagent.']
                          : []),
                ].join('\n')
            )
        );
        return;
    }

    p.note(createdPaths.map((item) => `- ${item}`).join('\n'), 'Created');
    p.outro(
        chalk.green(
            [
                resolved.options.subagent
                    ? `Sub-agent '${resolved.agentId}' initialized.`
                    : `Agent '${resolved.agentId}' initialized.`,
                ...(result.primaryAgent.status === 'set' && result.primaryAgent.id
                    ? [`Primary agent: ${result.primaryAgent.id}`]
                    : []),
                ...(subagentLinkResult?.status === 'set' && subagentLinkResult.parentAgentId
                    ? [`Linked to primary agent: ${subagentLinkResult.parentAgentId}`]
                    : subagentLinkResult?.status === 'no-primary'
                      ? [
                            'No primary agent found to link this subagent. Use `dexto init primary <id>` and rerun if needed.',
                        ]
                      : []),
            ].join('\n')
        )
    );
}

export async function handleInitSkillCommand(
    skillId: string,
    workspaceRoot: string = process.cwd()
): Promise<void> {
    p.intro(chalk.inverse('Dexto Init Skill'));

    const result = await createWorkspaceSkillScaffold(skillId, workspaceRoot);
    const createdPaths = formatSkillPaths(result);

    if (createdPaths.length === 0) {
        p.outro(chalk.green(`Skill '${skillId}' already initialized.`));
        return;
    }

    p.note(createdPaths.map((item) => `- ${item}`).join('\n'), 'Created');
    p.outro(chalk.green(`Skill '${skillId}' initialized.`));
}

export async function handleInitPrimaryCommand(
    agentIdInput: string | undefined,
    workspaceRoot: string = process.cwd()
): Promise<void> {
    p.intro(chalk.inverse('Dexto Init Primary'));

    const agentId = await resolvePrimaryAgentSelection(agentIdInput, workspaceRoot);
    const result = await setWorkspacePrimaryAgent(agentId, workspaceRoot);

    if (result.primaryAgent.status === 'existing') {
        p.outro(chalk.green(`'${agentId}' is already the workspace primary agent.`));
        return;
    }

    p.note(path.relative(result.workspace.root, result.registry.path), 'Updated');
    p.outro(chalk.green(`Primary agent set to '${agentId}'.`));
}

export async function handleInitStatusCommand(
    workspaceRoot: string = process.cwd()
): Promise<void> {
    p.intro(chalk.inverse('Dexto Init Status'));
    const result = await inspectWorkspaceStatus(workspaceRoot);
    p.outro(formatWorkspaceStatus(result));
}

export function registerInitCommand({ program }: InitCommandRegisterContext): void {
    const initCommand = program
        .command('init')
        .description('Initialize the current folder as a Dexto workspace');

    initCommand.addHelpText(
        'after',
        `
Examples:
  $ dexto init
  $ dexto init agent
  $ dexto init agent explore-agent --subagent
  $ dexto init primary review-agent
  $ dexto init skill code-review
  $ dexto init status
`
    );

    initCommand.action(
        withAnalytics('init', async () => {
            try {
                await handleInitCommand();
                safeExit('init', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto init command failed: ${err}`);
                safeExit('init', 1, 'error');
            }
        })
    );

    initCommand
        .command('agent [id]')
        .description('Create a workspace agent scaffold')
        .option('--subagent', 'Create a specialized sub-agent scaffold')
        .option('--primary', 'Set this agent as the workspace primary')
        .action(
            withAnalytics(
                'init agent',
                async (id: string | undefined, options: InitAgentCommandOptions) => {
                    try {
                        await handleInitAgentCommand(id, options);
                        safeExit('init agent', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`❌ dexto init agent command failed: ${err}`);
                        safeExit('init agent', 1, 'error');
                    }
                }
            )
        );

    initCommand
        .command('primary [id]')
        .description('Set the workspace primary agent')
        .action(
            withAnalytics('init primary', async (id: string | undefined) => {
                try {
                    await handleInitPrimaryCommand(id);
                    safeExit('init primary', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto init primary command failed: ${err}`);
                    safeExit('init primary', 1, 'error');
                }
            })
        );

    initCommand
        .command('skill <id>')
        .description('Create a workspace skill scaffold')
        .action(
            withAnalytics('init skill', async (id: string) => {
                try {
                    await handleInitSkillCommand(id);
                    safeExit('init skill', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto init skill command failed: ${err}`);
                    safeExit('init skill', 1, 'error');
                }
            })
        );

    initCommand
        .command('status')
        .description('Show the current workspace configuration and deploy preview')
        .action(
            withAnalytics('init status', async () => {
                try {
                    await handleInitStatusCommand();
                    safeExit('init status', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto init status command failed: ${err}`);
                    safeExit('init status', 1, 'error');
                }
            })
        );
}
