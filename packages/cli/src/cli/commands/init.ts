import * as p from '@clack/prompts';
import type { AgentConfig, ToolFactoryEntry } from '@dexto/agent-config';
import {
    createDextoAgentFromConfig,
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
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { ExitSignal, safeExit, withAnalytics } from '../../analytics/wrapper.js';
import { getEffectiveLLMConfig } from '../../config/effective-llm.js';
import { getDeployConfigPath, isWorkspaceDeployAgent, loadDeployConfig } from './deploy/config.js';
import { discoverPrimaryWorkspaceAgent } from './deploy/entry-agent.js';
import {
    confirmOrExit,
    multiselectOrExit,
    selectOrExit,
    textOrExit,
} from '../utils/prompt-helpers.js';
import { ensureImageImporterConfigured } from '../utils/image-importer.js';

const AGENTS_FILENAME = 'AGENTS.md';
const WORKSPACE_DIRECTORIES = ['agents', 'skills'] as const;
const SKILL_RESOURCE_DIRECTORIES = ['handlers', 'scripts', 'mcps', 'references'] as const;
const STARTER_SKILL_ID = 'create-skill';
const STARTER_SKILL_IDS = [STARTER_SKILL_ID] as const;
const DEFAULT_AGENT_PROVIDER: LLMProvider = 'openai';
const DEFAULT_AGENT_MODEL = 'gpt-5.3-codex';

const DEFAULT_AGENTS_MD = `<!-- dexto-workspace -->

# Dexto Workspace

This workspace can define project-specific agents and skills.

## Structure
- Put custom agents and subagents in \`agents/\`
- Put custom skills in \`skills/<skill-id>/\`
- Each skill bundle should keep \`SKILL.md\` plus optional \`handlers/\`, \`scripts/\`, \`mcps/\`, and \`references/\`
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
    resourceDirectories: Array<{ path: string; status: ScaffoldEntryStatus }>;
    extraFiles: Array<{ path: string; status: ScaffoldEntryStatus }>;
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
    displayName?: string;
    description?: string;
    systemPrompt?: string;
    greeting?: string;
    tools?: ToolFactoryEntry[];
};

type InitialAgentLlmConfig = {
    provider: LLMProvider;
    model: string;
    apiKey: string;
};

type AgentPromptMode = 'generate' | 'custom';
type AgentToolBundleId = 'workspace' | 'research' | 'planning' | 'memory' | 'automation';

type AgentWizardIdentity = {
    agentId: string;
    displayName: string;
};

type AgentWizardPromptResult = {
    mode: AgentPromptMode;
    systemPrompt: string;
    description: string | null;
};

type ResolvedInitAgentInput = {
    agentId: string;
    options: InitAgentCommandOptions;
};

type AgentToolBundleDefinition = {
    id: AgentToolBundleId;
    label: string;
    hint: string;
    entries: ToolFactoryEntry[];
};

const CORE_AGENT_TOOL_ENTRIES: ToolFactoryEntry[] = [
    {
        type: 'builtin-tools',
        enabledTools: ['ask_user', 'invoke_skill', 'sleep'],
    },
];

const ALWAYS_ENABLED_AGENT_TOOL_ENTRIES: ToolFactoryEntry[] = [
    { type: 'creator-tools' },
    { type: 'agent-spawner' },
];

const AGENT_TOOL_BUNDLES: AgentToolBundleDefinition[] = [
    {
        id: 'workspace',
        label: 'Filesystem & Terminal',
        hint: 'Read files and run commands in the workspace',
        entries: [{ type: 'filesystem-tools' }, { type: 'process-tools' }],
    },
    {
        id: 'research',
        label: 'Research and web',
        hint: 'Search the web, fetch URLs, and gather outside context',
        entries: [
            {
                type: 'builtin-tools',
                enabledTools: ['code_search', 'http_request', 'web_search'],
            },
        ],
    },
    {
        id: 'planning',
        label: 'Planning and tasks',
        hint: 'Track todos and keep structured plans',
        entries: [{ type: 'todo-tools' }, { type: 'plan-tools' }],
    },
    {
        id: 'memory',
        label: 'Memory and history',
        hint: 'Search conversation history, logs, and stored memories',
        entries: [{ type: 'lifecycle-tools' }],
    },
    {
        id: 'automation',
        label: 'Automation',
        hint: 'Schedule recurring jobs and proactive work',
        entries: [{ type: 'scheduler-tools' }],
    },
];

const DEFAULT_AGENT_TOOL_BUNDLE_IDS: AgentToolBundleId[] = ['workspace', 'planning'];
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROMPT_GENERATOR_AGENT_ID = 'init-agent-prompt-generator';

const GeneratedSystemPromptPayloadSchema = z
    .object({
        systemPrompt: z.string().trim().min(1),
    })
    .strict();

const AGENT_PROMPT_GENERATOR_SYSTEM_PROMPT = [
    'You design production-grade system prompts for Dexto agents.',
    'Your output will be written directly into agent YAML.',
    '',
    'Return only valid JSON with this exact shape:',
    '{"systemPrompt":"..."}',
    '',
    'Prompt requirements:',
    '- Start with "You are <agent name>..."',
    '- Turn the role description into a strong, practical operating prompt',
    '- Keep it general enough to work across different workspaces',
    '- Focus on responsibilities, operating principles, communication style, and constraints',
    '- Instruct the agent to understand the current workspace and context before acting',
    '- Tell the agent to surface risks, assumptions, and follow-up work when relevant',
    '- Mention tools abstractly instead of naming specific tool ids unless explicitly requested',
    '- If the agent is a subagent, include delegation guidance for working on behalf of a parent agent',
    '- Do not include markdown code fences or extra wrapper text',
].join('\n');

function buildInteractiveAgentIdentity(nameInput: string): AgentWizardIdentity {
    const trimmed = nameInput.trim();
    if (!trimmed) {
        throw new Error('Agent name is required.');
    }

    const agentId = trimmed
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    if (!agentId) {
        throw new Error('Agent name must include letters or numbers.');
    }

    return {
        agentId: normalizeScaffoldId(agentId, 'agent'),
        displayName: /[\sA-Z]/.test(trimmed) ? trimmed : deriveDisplayName(agentId),
    };
}

function getAgentDisplayName(agentId: string, options: InitAgentCommandOptions): string {
    return options.displayName?.trim() || deriveDisplayName(agentId);
}

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
    if (options.description?.trim()) {
        return options.description.trim();
    }

    if (options.subagent) {
        return `Workspace sub-agent '${agentId}' for delegated tasks.`;
    }

    if (agentId === 'coding-agent') {
        return 'Primary workspace agent for this project.';
    }

    return `Workspace agent '${agentId}' for this project.`;
}

function buildDefaultGeneratedPrompt(
    displayName: string,
    options: InitAgentCommandOptions
): string {
    const roleLabel = options.subagent ? 'specialized workspace subagent' : 'workspace agent';

    return [
        `You are ${displayName}, a ${roleLabel}.`,
        '',
        'Your role and focus:',
        '- Replace this section with the responsibilities you want this agent to own.',
        '',
        'Operating principles:',
        '- Read the relevant files and current state before taking action.',
        '- Keep responses concrete, direct, and grounded in the workspace.',
        '- Make the smallest correct change that moves the task forward.',
        '- Call out assumptions, risks, and follow-up work clearly.',
        ...(options.subagent
            ? [
                  '',
                  'Delegation guidance:',
                  '- Complete delegated work efficiently and return a crisp result to the parent agent.',
              ]
            : []),
    ].join('\n');
}

function buildScaffoldSystemPrompt(displayName: string, options: InitAgentCommandOptions): string {
    if (options.subagent) {
        return [
            `You are ${displayName}, a specialized sub-agent for this workspace.`,
            '',
            'Complete delegated tasks efficiently and concisely.',
            'Read the relevant files before responding.',
            'Return a clear result to the parent agent with concrete findings or next steps.',
        ].join('\n');
    }

    return [
        `You are ${displayName}, the workspace agent for this project.`,
        '',
        'Help the user understand, edit, run, and deploy the files in this workspace.',
        'Read relevant files before making changes.',
        'Keep changes focused and explain what changed.',
    ].join('\n');
}

function buildSystemPromptConfig(systemPrompt: string): AgentConfig['systemPrompt'] {
    return {
        contributors: [
            {
                id: 'primary',
                type: 'static',
                priority: 0,
                content: systemPrompt,
            },
            {
                id: 'date',
                type: 'dynamic',
                priority: 10,
                source: 'date',
            },
            {
                id: 'env',
                type: 'dynamic',
                priority: 15,
                source: 'env',
            },
        ],
    };
}

function extractJsonObjectFromResponse(content: string): string {
    const trimmed = content.trim();

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        return trimmed;
    }

    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
        return fencedMatch[1].trim();
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1);
    }

    throw new Error('Prompt generator did not return valid JSON.');
}

function parseGeneratedSystemPromptResponse(content: string): string {
    const parsed = JSON.parse(extractJsonObjectFromResponse(content)) as unknown;
    return GeneratedSystemPromptPayloadSchema.parse(parsed).systemPrompt;
}

function buildPromptGenerationRequest(
    displayName: string,
    roleDescription: string,
    options: InitAgentCommandOptions
): string {
    return [
        'Generate a Dexto system prompt from this brief.',
        '',
        `Agent name: ${displayName}`,
        `Agent type: ${options.subagent ? 'workspace subagent' : 'workspace agent'}`,
        `Role description: ${normalizeInteractiveDescription(roleDescription)}`,
        '',
        'Additional guidance:',
        '- Make the prompt concrete and opinionated, not generic filler',
        '- Prefer short sections and useful bullet points over long prose',
        '- Assume tool access may vary by workspace, so keep tool guidance capability-based',
        '- Avoid references to specific repositories, companies, or file names',
        '',
        'Return JSON only.',
    ].join('\n');
}

async function generateAgentSystemPromptFromDescription(
    displayName: string,
    roleDescription: string,
    options: InitAgentCommandOptions
): Promise<string> {
    await ensureImageImporterConfigured();
    const effectiveLLM = await getEffectiveLLMConfig();
    if (!effectiveLLM) {
        throw new Error(
            'No active LLM configuration is available for prompt generation. Configure one with `dexto setup` first.'
        );
    }

    const spinner = p.spinner();
    spinner.start('Generating system prompt...');

    const generatorAgent = await createDextoAgentFromConfig({
        agentIdOverride: PROMPT_GENERATOR_AGENT_ID,
        enrichOptions: {
            isInteractiveCli: false,
            skipPluginDiscovery: true,
        },
        config: {
            image: '@dexto/image-local',
            systemPrompt: buildSystemPromptConfig(AGENT_PROMPT_GENERATOR_SYSTEM_PROMPT),
            llm: {
                provider: effectiveLLM.provider,
                model: effectiveLLM.model,
                ...(effectiveLLM.apiKey ? { apiKey: effectiveLLM.apiKey } : {}),
                ...(effectiveLLM.baseURL ? { baseURL: effectiveLLM.baseURL } : {}),
            },
            storage: {
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: { type: 'in-memory' },
            },
            permissions: {
                mode: 'auto-deny',
                allowedToolsStorage: 'memory',
            },
            elicitation: {
                enabled: false,
            },
            tools: [],
        },
    });

    try {
        await generatorAgent.start();
        const session = await generatorAgent.createSession(PROMPT_GENERATOR_AGENT_ID);
        const response = await generatorAgent.generate(
            buildPromptGenerationRequest(displayName, roleDescription, options),
            session.id
        );
        const systemPrompt = parseGeneratedSystemPromptResponse(response.content);
        spinner.stop(chalk.green('Generated system prompt'));
        return systemPrompt;
    } catch (error) {
        spinner.stop(chalk.red('Failed to generate system prompt'));
        throw new Error(
            `Could not generate a system prompt automatically: ${error instanceof Error ? error.message : String(error)}`
        );
    } finally {
        await generatorAgent.stop().catch(() => undefined);
    }
}

function encodePromptForTextInput(systemPrompt: string): string {
    return systemPrompt.replace(/\n/g, '\\n');
}

function decodePromptFromTextInput(systemPrompt: string): string {
    return systemPrompt.replace(/\\n/g, '\n').trim();
}

function normalizeInteractiveDescription(description: string): string {
    const trimmed = description.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
        return trimmed;
    }

    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function cloneToolEntry(entry: ToolFactoryEntry): ToolFactoryEntry {
    const maybeEnabledTools = (entry as { enabledTools?: unknown }).enabledTools;

    return {
        ...entry,
        ...(Array.isArray(maybeEnabledTools)
            ? {
                  enabledTools: maybeEnabledTools.filter(
                      (tool): tool is string => typeof tool === 'string'
                  ),
              }
            : {}),
    };
}

function mergeToolEntries(entries: ToolFactoryEntry[]): ToolFactoryEntry[] {
    const merged = new Map<string, ToolFactoryEntry>();

    for (const entry of entries) {
        const existing = merged.get(entry.type);
        if (!existing) {
            merged.set(entry.type, cloneToolEntry(entry));
            continue;
        }

        const existingEnabledTools = (existing as { enabledTools?: unknown }).enabledTools;
        const nextEnabledTools = (entry as { enabledTools?: unknown }).enabledTools;

        if (Array.isArray(existingEnabledTools) && Array.isArray(nextEnabledTools)) {
            merged.set(entry.type, {
                ...existing,
                enabledTools: Array.from(
                    new Set([
                        ...existingEnabledTools.filter(
                            (tool): tool is string => typeof tool === 'string'
                        ),
                        ...nextEnabledTools.filter(
                            (tool): tool is string => typeof tool === 'string'
                        ),
                    ])
                ),
            });
            continue;
        }

        if (!Array.isArray(existingEnabledTools) && Array.isArray(nextEnabledTools)) {
            continue;
        }

        if (Array.isArray(existingEnabledTools) && !Array.isArray(nextEnabledTools)) {
            merged.set(entry.type, cloneToolEntry(entry));
            continue;
        }

        merged.set(entry.type, cloneToolEntry(entry));
    }

    return Array.from(merged.values());
}

function buildToolConfigFromBundleIds(bundleIds: AgentToolBundleId[]): ToolFactoryEntry[] {
    const selectedBundleEntries = bundleIds.flatMap((bundleId) => {
        const bundle = AGENT_TOOL_BUNDLES.find((entry) => entry.id === bundleId);
        return bundle?.entries ?? [];
    });

    return mergeToolEntries([
        ...CORE_AGENT_TOOL_ENTRIES,
        ...ALWAYS_ENABLED_AGENT_TOOL_ENTRIES,
        ...selectedBundleEntries,
    ]);
}

function formatBundleSelection(bundleIds: AgentToolBundleId[]): string {
    if (bundleIds.length === 0) {
        return 'Core utilities only';
    }

    return bundleIds
        .map(
            (bundleId) =>
                AGENT_TOOL_BUNDLES.find((bundle) => bundle.id === bundleId)?.label ?? bundleId
        )
        .join(', ');
}

function renderPromptPreview(systemPrompt: string): void {
    console.log(`\n${chalk.cyan.bold('System Prompt Preview')}`);
    console.log(chalk.dim('Review the full prompt before continuing.\n'));
    console.log(systemPrompt);
    console.log();
}

function getPreferredEditorCommand(): string {
    const envEditor = process.env.VISUAL?.trim() || process.env.EDITOR?.trim();
    if (envEditor) {
        return envEditor;
    }

    return process.platform === 'win32' ? 'notepad' : 'vi';
}

async function openFileInEditor(editorCommand: string, filePath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(editorCommand, [filePath], {
            stdio: 'inherit',
            shell: true,
        });

        child.once('error', reject);
        child.once('exit', (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(`Editor exited with code ${code ?? 'unknown'}.`));
        });
    });
}

async function editSystemPromptInEditor(
    displayName: string,
    options: InitAgentCommandOptions,
    initialPrompt?: string
): Promise<string> {
    const editorCommand = getPreferredEditorCommand();
    const initialContent = initialPrompt ?? buildDefaultGeneratedPrompt(displayName, options);
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dexto-agent-prompt-'));
    const promptPath = path.join(tempDir, 'system-prompt.md');

    try {
        await fs.writeFile(promptPath, `${initialContent}\n`, 'utf8');
        p.log.info(
            `Opening ${chalk.cyan(editorCommand)} for prompt editing. Save and close the editor to continue.`
        );

        while (true) {
            await openFileInEditor(editorCommand, promptPath);
            const editedPrompt = (await fs.readFile(promptPath, 'utf8')).trim();

            if (editedPrompt) {
                return editedPrompt;
            }

            p.log.warn('System prompt was empty. Reopening the editor.');
        }
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

async function promptForAgentName(initialValue?: string): Promise<AgentWizardIdentity> {
    const rawName = await textOrExit(
        {
            message: 'Agent name',
            ...(initialValue ? { initialValue } : {}),
            placeholder: 'Review Agent',
            validate(value) {
                try {
                    buildInteractiveAgentIdentity(value);
                    return undefined;
                } catch (error) {
                    return error instanceof Error ? error.message : 'Invalid agent name';
                }
            },
        },
        'Agent initialization cancelled'
    );

    return buildInteractiveAgentIdentity(rawName);
}

async function promptForAvailableAgentName(workspaceRoot: string): Promise<AgentWizardIdentity> {
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    let initialValue: string | undefined;

    while (true) {
        const identity = await promptForAgentName(initialValue);
        const registryState = await loadWorkspaceProjectRegistry(resolvedWorkspaceRoot);
        const existingEntry = getWorkspaceAgentEntry(registryState.registry, identity.agentId);

        if (!existingEntry) {
            return identity;
        }

        p.log.warn(
            `Agent '${identity.agentId}' already exists in ${path.relative(resolvedWorkspaceRoot, registryState.path)}. Choose a different name or run \`dexto init agent ${identity.agentId}\` to update the existing agent.`
        );
        initialValue = identity.displayName;
    }
}

async function promptForCustomSystemPrompt(
    displayName: string,
    options: InitAgentCommandOptions,
    initialPrompt?: string
): Promise<string> {
    try {
        return await editSystemPromptInEditor(displayName, options, initialPrompt);
    } catch (error) {
        p.log.warn(
            `Could not open an editor cleanly. Falling back to inline prompt editing. ${error instanceof Error ? error.message : String(error)}`
        );

        const rawPrompt = await textOrExit(
            {
                message: 'System prompt (use \\n for line breaks)',
                initialValue: encodePromptForTextInput(
                    initialPrompt ?? buildDefaultGeneratedPrompt(displayName, options)
                ),
                placeholder: encodePromptForTextInput(
                    buildDefaultGeneratedPrompt(displayName, options)
                ),
                validate(value) {
                    const decoded = decodePromptFromTextInput(value);
                    return decoded ? undefined : 'System prompt is required';
                },
            },
            'Agent initialization cancelled'
        );

        return decodePromptFromTextInput(rawPrompt);
    }
}

async function promptForReviewedCustomSystemPrompt(
    displayName: string,
    options: InitAgentCommandOptions,
    initialPrompt?: string
): Promise<string> {
    let customPrompt = initialPrompt ?? '';

    while (true) {
        customPrompt = await promptForCustomSystemPrompt(displayName, options, customPrompt);
        renderPromptPreview(customPrompt);

        const confirmed = await confirmOrExit(
            {
                message: 'Use this system prompt?',
                initialValue: true,
            },
            'Agent initialization cancelled'
        );

        if (confirmed) {
            return customPrompt;
        }
    }
}

async function promptForAgentSystemPrompt(
    displayName: string,
    options: InitAgentCommandOptions
): Promise<AgentWizardPromptResult> {
    const effectiveLLM = await getEffectiveLLMConfig();
    if (!effectiveLLM) {
        p.log.info(
            'No active LLM configuration found. Opening the prompt editor instead. Run `dexto setup` to enable automatic prompt generation.'
        );

        return {
            mode: 'custom',
            systemPrompt: await promptForReviewedCustomSystemPrompt(displayName, options),
            description: null,
        };
    }

    const promptMode = await selectOrExit<AgentPromptMode>(
        {
            message: 'How do you want to create the system prompt?',
            initialValue: 'generate',
            options: [
                {
                    value: 'generate',
                    label: 'Generate from description',
                    hint: 'Start from a short role description and review the full prompt',
                },
                {
                    value: 'custom',
                    label: 'Write custom prompt',
                    hint: 'Enter your own prompt text directly',
                },
            ],
        },
        'Agent initialization cancelled'
    );

    if (promptMode === 'custom') {
        return {
            mode: 'custom',
            systemPrompt: await promptForReviewedCustomSystemPrompt(displayName, options),
            description: null,
        };
    }

    let roleDescription = await textOrExit(
        {
            message: 'Describe this agent’s role',
            placeholder: 'Reviews code changes, finds risks, and suggests focused fixes.',
            validate(value) {
                return value.trim() ? undefined : 'Role description is required';
            },
        },
        'Agent initialization cancelled'
    );

    let systemPrompt = await generateAgentSystemPromptFromDescription(
        displayName,
        roleDescription,
        options
    );

    while (true) {
        renderPromptPreview(systemPrompt);

        const action = await selectOrExit<'continue' | 'edit' | 'regenerate'>(
            {
                message: 'What do you want to do with this prompt?',
                initialValue: 'continue',
                options: [
                    {
                        value: 'continue',
                        label: 'Continue',
                        hint: 'Use this prompt as-is',
                    },
                    {
                        value: 'edit',
                        label: 'Edit prompt',
                        hint: 'Make direct changes to the generated prompt',
                    },
                    {
                        value: 'regenerate',
                        label: 'Regenerate',
                        hint: 'Update the role description and rebuild the prompt',
                    },
                ],
            },
            'Agent initialization cancelled'
        );

        if (action === 'continue') {
            return {
                mode: 'generate',
                systemPrompt,
                description: normalizeInteractiveDescription(roleDescription),
            };
        }

        if (action === 'edit') {
            systemPrompt = await promptForCustomSystemPrompt(displayName, options, systemPrompt);
            continue;
        }

        roleDescription = await textOrExit(
            {
                message: 'Describe this agent’s role',
                initialValue: roleDescription,
                validate(value) {
                    return value.trim() ? undefined : 'Role description is required';
                },
            },
            'Agent initialization cancelled'
        );
        systemPrompt = await generateAgentSystemPromptFromDescription(
            displayName,
            roleDescription,
            options
        );
    }
}

async function promptForAgentToolBundles(): Promise<AgentToolBundleId[]> {
    return await multiselectOrExit<AgentToolBundleId>(
        {
            message: 'Select tool bundles (agent creation is enabled by default)',
            initialValues: DEFAULT_AGENT_TOOL_BUNDLE_IDS,
            options: AGENT_TOOL_BUNDLES.map((bundle) => ({
                value: bundle.id,
                label: bundle.label,
                hint: bundle.hint,
            })),
        },
        'Agent initialization cancelled'
    );
}

async function describePlannedAgentRole(
    options: InitAgentCommandOptions,
    workspaceRoot: string
): Promise<string> {
    const registryState = await loadWorkspaceProjectRegistry(path.resolve(workspaceRoot));
    const currentPrimaryAgentId = getEffectiveWorkspacePrimaryAgentId(registryState.registry);

    if (options.subagent) {
        return currentPrimaryAgentId
            ? `Subagent (will link to ${currentPrimaryAgentId})`
            : 'Subagent (no primary agent available yet)';
    }

    if (options.primary) {
        return currentPrimaryAgentId
            ? `Primary agent (replaces ${currentPrimaryAgentId})`
            : 'Primary agent';
    }

    return currentPrimaryAgentId ? 'Additional agent' : 'Primary agent (first workspace agent)';
}

async function resolveInteractiveAgentRoleOptions(
    options: InitAgentCommandOptions,
    workspaceRoot: string
): Promise<InitAgentCommandOptions> {
    if (options.subagent || options.primary) {
        return options;
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

    return {
        ...options,
        ...(kind === 'primary' ? { primary: true } : {}),
        ...(kind === 'subagent' ? { subagent: true } : {}),
    };
}

async function buildAgentConfig(
    agentId: string,
    options: InitAgentCommandOptions
): Promise<AgentConfig> {
    const llmConfig = await loadInitialAgentLlmConfig();
    const displayName = getAgentDisplayName(agentId, options);
    const systemPrompt = options.systemPrompt ?? buildScaffoldSystemPrompt(displayName, options);
    const usesAskUser =
        options.tools === undefined ||
        options.tools.some((entry) => {
            if (entry.type !== 'builtin-tools' || entry.enabled === false) {
                return false;
            }

            const maybeEnabledTools = (entry as { enabledTools?: unknown }).enabledTools;
            return (
                !Array.isArray(maybeEnabledTools) ||
                maybeEnabledTools.some((tool) => tool === 'ask_user')
            );
        });

    const llm: AgentConfig['llm'] = {
        provider: llmConfig.provider,
        model: llmConfig.model,
        apiKey: llmConfig.apiKey,
    };

    return {
        image: '@dexto/image-local',
        systemPrompt: buildSystemPromptConfig(systemPrompt),
        greeting:
            options.greeting ??
            (options.subagent
                ? `Ready to help as ${displayName}.`
                : 'Ready to work in this workspace.'),
        llm,
        ...(options.tools ? { tools: options.tools } : {}),
        permissions: {
            mode: 'manual',
            allowedToolsStorage: 'storage',
        },
        ...(usesAskUser
            ? {
                  elicitation: {
                      enabled: true,
                  },
              }
            : {}),
    };
}

function buildRegistryEntry(
    agentId: string,
    options: InitAgentCommandOptions
): WorkspaceProjectRegistryEntry {
    const description = buildAgentDescription(agentId, options);
    return {
        id: agentId,
        name: getAgentDisplayName(agentId, options),
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

async function resolveInitAgentInput(
    agentIdInput: string | undefined,
    options: InitAgentCommandOptions,
    workspaceRoot: string
): Promise<ResolvedInitAgentInput | null> {
    validateInitAgentOptions(options);

    if (agentIdInput) {
        return {
            agentId: normalizeScaffoldId(agentIdInput, 'agent'),
            options,
        };
    }

    const resolvedOptions = await resolveInteractiveAgentRoleOptions(options, workspaceRoot);
    const identity = await promptForAvailableAgentName(workspaceRoot);
    const promptResult = await promptForAgentSystemPrompt(identity.displayName, resolvedOptions);
    const bundleIds = await promptForAgentToolBundles();
    const roleSummary = await describePlannedAgentRole(resolvedOptions, workspaceRoot);
    const selectedTools = buildToolConfigFromBundleIds(bundleIds);

    p.note(
        [
            `${chalk.cyan('Name:')} ${chalk.bold(identity.displayName)}`,
            `${chalk.cyan('Id:')} ${chalk.dim(identity.agentId)}`,
            `${chalk.cyan('Workspace role:')} ${roleSummary}`,
            `${chalk.cyan('System prompt:')} ${promptResult.mode === 'generate' ? 'Generated from description' : 'Custom'}`,
            `${chalk.cyan('Tool bundles:')} ${formatBundleSelection(bundleIds)}`,
            `${chalk.cyan('Core utilities:')} ask_user, invoke_skill, sleep`,
            `${chalk.cyan('Agent creation:')} enabled by default`,
        ].join('\n'),
        'Agent Summary'
    );

    const confirmed = await confirmOrExit(
        {
            message: 'Create this agent?',
            initialValue: true,
        },
        'Agent initialization cancelled'
    );

    if (!confirmed) {
        return null;
    }

    return {
        agentId: identity.agentId,
        options: {
            ...resolvedOptions,
            displayName: identity.displayName,
            description:
                promptResult.description ??
                buildAgentDescription(identity.agentId, resolvedOptions),
            systemPrompt: promptResult.systemPrompt,
            greeting: `Ready to help as ${identity.displayName}.`,
            tools: selectedTools,
        },
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

## When To Use
- The task or context that should trigger this skill
- Relevant files, paths, or constraints

## Workflow
1. Review the relevant context and only open bundled files that are actually needed.
2. Use \`references/\` for background knowledge, schemas, or examples.
3. Use \`scripts/\` for deterministic helper code and \`handlers/\` for reusable workflow logic.
4. Use \`mcps/\` for any MCP server configs this skill needs to carry with it.
5. Return a concise result with any important follow-up actions.

## Bundled Resources
- \`handlers/\`: Reusable workflow helpers or code snippets this skill can point to
- \`scripts/\`: Executable helpers for deterministic or repetitive tasks
- \`mcps/\`: MCP server config JSON files associated with this skill
- \`references/\`: Docs, schemas, examples, or domain notes to load on demand

## Output Format
- Summary of what was found or changed
- Key decisions or recommendations
- Follow-up actions, if any
`;
}

function buildCreateSkillStarterTemplate(): string {
    return `---
name: "${STARTER_SKILL_ID}"
description: "Create or update Dexto skill bundles with SKILL.md, handlers, scripts, mcps, and references."
toolkits: ["creator-tools"]
allowed-tools: ["skill_create", "skill_update", "skill_refresh", "skill_search", "skill_list", "tool_catalog"]
---

# Create Skill

Create or update standalone Dexto skill bundles. Treat \`skills/<id>/\` as the canonical workspace location unless the user explicitly asks for a global skill.

## Core Flow
1. Search for overlap first with \`skill_list\` and \`skill_search\`.
2. Propose a kebab-case id, one-sentence description, scope, and the minimum tool access the skill needs.
3. Create or update the skill bundle.
4. Keep \`SKILL.md\` focused on trigger conditions, workflow, and when to open bundled files.
5. Add bundled files only when they materially improve the workflow:
   - \`references/\` for larger docs, copied external material, schemas, examples, or policies
   - \`scripts/\` for deterministic helpers
   - \`handlers/\` for reusable workflow logic or structured helper code
   - \`mcps/\` for MCP configs the skill should carry with it
   - When a skill needs a real bundled MCP server, prefer the SDK-based stdio pattern in \`references/mcp-server-pattern.md\`
6. Prefer extending existing skills or references over duplicating content.
7. If you edit \`SKILL.md\` or bundled files with non-creator tools, run \`skill_refresh\` before relying on the skill in the current session.
8. Creating \`mcps/*.json\` only creates bundled MCP config. Do not say you created a real MCP server unless the config points at a bundled runnable implementation or a verified external command/package.

## Authoring Rules
- Default to workspace scope.
- Default to no extra toolkits and no \`allowed-tools\` unless the skill needs them.
- Keep most actionable instructions in \`SKILL.md\` so the agent can act without opening extra files.
- Use \`references/\` sparingly for larger copied docs, external references, schemas, examples, or policies.
- Keep references one level deep from \`SKILL.md\` and link them explicitly.
- Reuse language and conventions from nearby skills when possible.
- If you add MCP config files or update bundled resources outside creator tools, run \`skill_refresh\` so the current session reloads the skill metadata before invoking it.
- For real bundled MCPs, prefer the official \`@modelcontextprotocol/sdk\` server APIs with \`StdioServerTransport\`. Avoid hand-rolled Content-Length framing unless the user explicitly asks for low-level protocol code.

## SKILL.md Structure
- \`# <Title>\`
- \`## Purpose\`
- \`## When To Use\`
- \`## Workflow\`
- \`## Bundled Resources\`
- \`## Output Format\`

## Resource Guide
Read \`references/skill-anatomy.md\` when you need the bundle layout or packaging checklist.
Read \`references/mcp-server-pattern.md\` when the skill needs a bundled MCP server implementation.
`;
}

function buildCreateSkillStarterReference(): string {
    return `# Skill Anatomy

## Canonical Layout
\`\`\`
skills/<skill-id>/
├── SKILL.md
├── handlers/
├── scripts/
├── mcps/
└── references/
\`\`\`

## What Goes Where
- \`SKILL.md\`: The trigger, workflow, and navigation entrypoint.
- \`handlers/\`: Reusable helper code or structured workflow fragments the skill can reference.
- \`scripts/\`: Deterministic helpers the agent can run instead of rewriting logic.
- \`mcps/\`: JSON config fragments for MCP servers used by the skill. This is config only, not proof that the MCP implementation exists.
- \`references/\`: Supporting material the agent should open only when needed, especially larger copied docs, schemas, external references, or long examples.

## Creation Checklist
1. Search existing skills first to avoid duplicates.
2. Pick a kebab-case id and concise description.
3. Keep actionable workflow in \`SKILL.md\`; move only larger reference material into \`references/\`.
4. Add scripts or handlers only when they remove repeated work or improve reliability.
5. Add MCP configs only when the skill truly depends on them.
6. Reference bundled files from \`SKILL.md\` using relative paths.

## MCP Notes
- Store standalone skill MCP configs as JSON files in \`mcps/\`.
- Each file may define one or more servers using the same shape as \`.mcp.json\`.
- Skill MCP configs are bundled metadata. They do not by themselves implement or verify an MCP server.
- If you claim the skill ships a real MCP, the config must point to a bundled runnable server or a verified external package/command.
- Run \`skill_refresh\` after editing bundled files so the running session reloads the latest skill content and MCP metadata.
`;
}

function buildCreateSkillMcpReference(): string {
    return `# MCP Server Pattern

Use this pattern when a skill needs to bundle a real MCP server in \`scripts/\`.

## Preferred Approach
- Use the official \`@modelcontextprotocol/sdk\` server APIs.
- Use \`StdioServerTransport\` for bundled local servers.
- Keep the MCP config in \`mcps/*.json\` simple and skill-relative.
- Prefer \`.mjs\` for bundled MCP server scripts to avoid CommonJS/ESM ambiguity.

## Avoid
- Do not hand-roll MCP framing with manual \`Content-Length\` parsing unless the user explicitly asks for low-level protocol code.
- Do not claim the MCP works just because the script exists or passes \`node --check\`.
- Do not stop at writing \`mcps/*.json\` if the user asked for a real MCP implementation.

## Minimal Server Template
\`\`\`js
#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
    {
        name: 'my-skill-server',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'my_tool',
            description: 'Describe what the tool does.',
            inputSchema: {
                type: 'object',
                properties: {
                    value: {
                        type: 'string',
                    },
                },
                required: ['value'],
            },
        },
    ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'my_tool') {
        throw new Error(\`Unknown tool: \${request.params.name}\`);
    }

    const value =
        typeof request.params.arguments?.value === 'string' ? request.params.arguments.value : '';

    return {
        content: [
            {
                type: 'text',
                text: \`Handled: \${value}\`,
            },
        ],
        structuredContent: {
            value,
        },
    };
});

const transport = new StdioServerTransport();
await server.connect(transport);
\`\`\`

## Matching MCP Config
\`\`\`json
{
  "mcpServers": {
    "my_server": {
      "type": "stdio",
      "command": "node",
      "args": ["scripts/my-skill-server.mjs"]
    }
  }
}
\`\`\`

## Verification Sequence
1. Create or update \`SKILL.md\`, \`scripts/\`, and \`mcps/\`.
2. Run \`skill_refresh\` after non-creator file edits.
3. Invoke the skill in the current session.
4. Confirm the bundled MCP connects and the new MCP tool appears.
5. Call the MCP tool once with a simple input and confirm the result.

If step 3 or 4 fails, the skill is not done yet.
`;
}

function buildSkillExtraFiles(skillId: string): Array<{ relativePath: string; content: string }> {
    if (skillId === STARTER_SKILL_ID) {
        return [
            {
                relativePath: path.join('references', 'skill-anatomy.md'),
                content: buildCreateSkillStarterReference(),
            },
            {
                relativePath: path.join('references', 'mcp-server-pattern.md'),
                content: buildCreateSkillMcpReference(),
            },
        ];
    }

    return [];
}

function buildSkillTemplateForId(skillId: string): string {
    if (skillId === STARTER_SKILL_ID) {
        return buildCreateSkillStarterTemplate();
    }

    return buildSkillTemplate(skillId);
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

    const resourceDirectories: WorkspaceSkillScaffoldResult['resourceDirectories'] = [];
    const extraFiles: WorkspaceSkillScaffoldResult['extraFiles'] = [];

    await ensureDirectory(skillDirPath);
    const skillFileStatus = await ensureFile(skillFilePath, buildSkillTemplateForId(skillId));

    for (const directory of SKILL_RESOURCE_DIRECTORIES) {
        const resourcePath = path.join(skillDirPath, directory);
        const status = await ensureDirectory(resourcePath);
        resourceDirectories.push({ path: resourcePath, status });
    }

    for (const file of buildSkillExtraFiles(skillId)) {
        const filePath = path.join(skillDirPath, file.relativePath);
        await ensureDirectory(path.dirname(filePath));
        const status = await ensureFile(filePath, file.content);
        extraFiles.push({ path: filePath, status });
    }

    return {
        workspace,
        skillFile: {
            path: skillFilePath,
            status: skillFileStatus,
        },
        resourceDirectories,
        extraFiles,
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

    for (const directory of result.resourceDirectories) {
        if (directory.status === 'created') {
            createdPaths.push(path.relative(result.workspace.root, directory.path));
        }
    }

    for (const file of result.extraFiles) {
        if (file.status === 'created') {
            createdPaths.push(path.relative(result.workspace.root, file.path));
        }
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
    const starterSkills = await Promise.all(
        STARTER_SKILL_IDS.map((skillId) => createWorkspaceSkillScaffold(skillId, workspaceRoot))
    );
    const workspacePaths = formatCreatedPaths(result);
    const createdPaths = [
        ...workspacePaths,
        ...starterSkills.flatMap((skill) =>
            formatSkillPaths(skill).filter((item) => !workspacePaths.includes(item))
        ),
    ];

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
    if (!resolved) {
        p.outro(chalk.yellow('Agent initialization cancelled.'));
        return;
    }

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
