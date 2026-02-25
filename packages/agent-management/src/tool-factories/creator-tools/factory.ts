import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as yamlParse } from 'yaml';
import type { ToolFactory } from '@dexto/agent-config';
import {
    ToolError,
    defineTool,
    assertValidPromptName,
    type Tool,
    type ToolExecutionContext,
    type PromptsConfig,
    type PromptInfo,
} from '@dexto/core';
import { discoverStandaloneSkills, getSkillSearchPaths } from '../../plugins/discover-skills.js';
import {
    CREATOR_TOOL_NAMES,
    CreatorToolsConfigSchema,
    type CreatorToolName,
    type CreatorToolsConfig,
} from './schemas.js';
import { getDextoGlobalPath } from '../../utils/path.js';
import { z } from 'zod';

/**
 * Creator tools handle SKILL.md lifecycle with guardrails beyond raw file writes:
 * - validation (ids + inputs)
 * - safety (path confinement)
 * - consistent frontmatter shaping
 * - prompt refresh so skills are immediately available
 * - scope-aware paths (workspace/global)
 */
const SkillCreateInputSchema = z
    .object({
        id: z.string().min(1).describe('Skill id (kebab-case).'),
        description: z.string().min(1).describe('Short description of what the skill does.'),
        content: z.string().min(1).describe('Skill body (markdown) without frontmatter.'),
        allowedTools: z
            .array(z.string().min(1))
            .optional()
            .describe('Optional allowed-tools list for the skill frontmatter.'),
        toolkits: z
            .array(z.string().min(1))
            .optional()
            .describe('Optional toolkits list for the skill frontmatter.'),
        scope: z.enum(['global', 'workspace']).optional(),
        overwrite: z.boolean().optional(),
    })
    .strict();

const SkillUpdateInputSchema = z
    .object({
        id: z.string().min(1),
        content: z.string().min(1).describe('New SKILL.md body (markdown) without frontmatter.'),
        description: z.string().min(1).optional(),
        allowedTools: z
            .array(z.string().min(1))
            .optional()
            .describe('Optional allowed-tools list for the skill frontmatter.'),
        toolkits: z
            .array(z.string().min(1))
            .optional()
            .describe('Optional toolkits list for the skill frontmatter.'),
        scope: z.enum(['global', 'workspace']).optional(),
    })
    .strict();

const SkillListInputSchema = z
    .object({
        projectPath: z.string().optional(),
        query: z
            .string()
            .optional()
            .describe('Optional search term to filter skills by name or path'),
    })
    .strict();

const SkillSearchInputSchema = z
    .object({
        query: z
            .string()
            .optional()
            .describe('Optional search term to filter skills by name or description'),
        limit: z
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .describe(
                'Maximum number of skills to return. If omitted, all matches are returned for queries; otherwise defaults to 50.'
            ),
    })
    .strict();

const ToolCatalogInputSchema = z
    .object({
        query: z
            .string()
            .optional()
            .describe('Optional search term to filter tools by id or description'),
        limit: z
            .number()
            .int()
            .min(1)
            .max(500)
            .optional()
            .describe('Maximum number of tools to return (defaults to all).'),
        includeDescriptions: z
            .boolean()
            .optional()
            .describe('Include tool descriptions (defaults to true).'),
    })
    .strict();

type SkillSearchEntry = {
    id: string;
    name: string;
    description?: string;
    displayName?: string;
    commandName?: string;
    context?: PromptInfo['context'];
    agent?: string;
};

type ToolCatalogEntry = {
    id: string;
    description?: string;
    source: 'local' | 'mcp';
};

function normalizeSkillQuery(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function matchesSkillQuery(value: string | undefined, query: string): boolean {
    if (!value) return false;
    const normalizedQuery = normalizeSkillQuery(query);
    if (!normalizedQuery) return false;
    return normalizeSkillQuery(value).includes(normalizedQuery);
}

function resolvePromptSkillName(info: PromptInfo, id: string): string {
    return info.displayName || info.name || id;
}

function resolveWorkspaceBasePath(context: ToolExecutionContext): string {
    const workspacePath = context.workspace?.path;
    const fallbackWorkingDir = context.services
        ? (
              context.services as {
                  filesystemService?: { getConfig: () => { workingDirectory?: string } };
              }
          ).filesystemService?.getConfig().workingDirectory
        : undefined;
    return workspacePath || fallbackWorkingDir || process.cwd();
}

function resolveWorkspaceSkillDirs(context: ToolExecutionContext): {
    primary: string;
    legacy: string;
} {
    const base = resolveWorkspaceBasePath(context);
    return {
        primary: path.join(base, '.agents', 'skills'),
        legacy: path.join(base, '.dexto', 'skills'),
    };
}

function resolveSkillBaseDirectory(
    scope: 'global' | 'workspace' | undefined,
    context: ToolExecutionContext
): { baseDir: string; scope: 'global' | 'workspace' } {
    if (scope === 'global') {
        return { baseDir: getDextoGlobalPath('skills'), scope: 'global' };
    }

    return { baseDir: resolveWorkspaceSkillDirs(context).primary, scope: 'workspace' };
}

function resolveSkillDirectory(
    input: z.output<typeof SkillCreateInputSchema>,
    context: ToolExecutionContext
): { baseDir: string; scope: 'global' | 'workspace' } {
    return resolveSkillBaseDirectory(input.scope, context);
}

async function pathExists(filePath: string): Promise<boolean> {
    return await fs
        .stat(filePath)
        .then(() => true)
        .catch(() => false);
}

async function resolveSkillUpdateDirectory(
    input: z.output<typeof SkillUpdateInputSchema>,
    context: ToolExecutionContext
): Promise<{ baseDir: string; scope: 'global' | 'workspace' }> {
    if (input.scope === 'global') {
        return resolveSkillBaseDirectory('global', context);
    }

    const { primary, legacy } = resolveWorkspaceSkillDirs(context);
    const skillId = input.id.trim();
    const primaryFile = path.join(primary, skillId, 'SKILL.md');
    if (await pathExists(primaryFile)) {
        return { baseDir: primary, scope: 'workspace' };
    }

    const legacyFile = path.join(legacy, skillId, 'SKILL.md');
    if (await pathExists(legacyFile)) {
        return { baseDir: legacy, scope: 'workspace' };
    }

    return { baseDir: primary, scope: 'workspace' };
}

function ensurePathWithinBase(baseDir: string, targetDir: string, toolId: string): void {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetDir);
    const rel = path.relative(resolvedBase, resolvedTarget);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw ToolError.validationFailed(toolId, 'invalid skill path');
    }
}

function formatFrontmatterLine(key: string, value: string | number | boolean): string {
    if (typeof value === 'string') {
        return `${key}: ${JSON.stringify(value)}`;
    }
    return `${key}: ${value}`;
}

type ResolvedSkillCreateInput = z.output<typeof SkillCreateInputSchema> & {
    id: string;
    description: string;
    content: string;
};

function titleizeSkillId(id: string): string {
    return id
        .split('-')
        .filter(Boolean)
        .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
        .join(' ');
}

function resolveSkillCreateInput(
    input: z.output<typeof SkillCreateInputSchema>
): ResolvedSkillCreateInput {
    const id = input.id.trim();
    const description = input.description.trim();
    const content = input.content.trim();

    return {
        ...input,
        id,
        description,
        content,
    };
}

function formatFrontmatterList(key: string, values: string[]): string {
    const normalized = values.map((value) => JSON.stringify(value.trim()));
    return `${key}: [${normalized.join(', ')}]`;
}

function buildSkillMarkdownFromParts(options: {
    id: string;
    description: string;
    content: string;
    allowedTools?: string[] | undefined;
    toolkits?: string[] | undefined;
}): string {
    const id = options.id.trim();
    const title = titleizeSkillId(id) || id;
    const lines: string[] = ['---'];

    lines.push(formatFrontmatterLine('name', id));
    lines.push(formatFrontmatterLine('description', options.description.trim()));
    if (options.toolkits && options.toolkits.length > 0) {
        lines.push(formatFrontmatterList('toolkits', options.toolkits));
    }
    if (options.allowedTools && options.allowedTools.length > 0) {
        lines.push(formatFrontmatterList('allowed-tools', options.allowedTools));
    }

    lines.push('---', '', `# ${title}`, '', options.content.trim());
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function buildSkillMarkdown(input: ResolvedSkillCreateInput): string {
    return buildSkillMarkdownFromParts({
        id: input.id,
        description: input.description,
        content: input.content,
        allowedTools: input.allowedTools,
        toolkits: input.toolkits,
    });
}

async function readSkillFrontmatter(skillFile: string): Promise<{
    name?: string;
    description?: string;
    allowedTools?: string[];
    toolkits?: string[];
}> {
    try {
        const raw = await fs.readFile(skillFile, 'utf-8');
        const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
        if (!match) return {};
        const frontmatter = yamlParse(match[1] ?? '') as Record<string, unknown> | null;
        if (!frontmatter || typeof frontmatter !== 'object') return {};
        const name = typeof frontmatter.name === 'string' ? frontmatter.name.trim() : undefined;
        const description =
            typeof frontmatter.description === 'string'
                ? frontmatter.description.trim()
                : undefined;
        const allowedToolsRaw = frontmatter['allowed-tools'];
        const toolkitsRaw = frontmatter.toolkits;
        const allowedTools = Array.isArray(allowedToolsRaw)
            ? allowedToolsRaw
                  .filter((item): item is string => typeof item === 'string')
                  .map((item) => item.trim())
                  .filter((item) => item.length > 0)
            : undefined;
        const toolkits = Array.isArray(toolkitsRaw)
            ? toolkitsRaw
                  .filter((item): item is string => typeof item === 'string')
                  .map((item) => item.trim())
                  .filter((item) => item.length > 0)
            : undefined;
        const result: {
            name?: string;
            description?: string;
            allowedTools?: string[];
            toolkits?: string[];
        } = {};
        if (name) result.name = name;
        if (description) result.description = description;
        if (allowedTools && allowedTools.length > 0) result.allowedTools = allowedTools;
        if (toolkits && toolkits.length > 0) result.toolkits = toolkits;
        return result;
    } catch {
        return {};
    }
}

async function refreshAgentPrompts(
    context: ToolExecutionContext,
    skillFile: string
): Promise<boolean> {
    const agent = context.agent;
    if (!agent) return false;

    const effective = agent.getEffectiveConfig();
    const existingPrompts = Array.isArray(effective.prompts) ? [...effective.prompts] : [];
    const alreadyPresent = existingPrompts.some((prompt) => {
        if (!prompt || typeof prompt !== 'object') return false;
        const record = prompt as { type?: string; file?: string };
        return record.type === 'file' && record.file === skillFile;
    });

    const nextPrompts: PromptsConfig = alreadyPresent
        ? (existingPrompts as PromptsConfig)
        : ([...existingPrompts, { type: 'file', file: skillFile }] as PromptsConfig);

    await agent.refreshPrompts(nextPrompts);
    return true;
}

export const creatorToolsFactory: ToolFactory<CreatorToolsConfig> = {
    configSchema: CreatorToolsConfigSchema,
    metadata: {
        displayName: 'Creator Tools',
        description: 'Create and manage standalone skills',
        category: 'agents',
    },
    create: (config) => {
        const enabledTools = config.enabledTools ?? CREATOR_TOOL_NAMES;

        const skillCreateTool = defineTool({
            id: 'skill_create',
            description:
                'Create a standalone SKILL.md file and register it with the running agent. Provide id, description, content, and optional toolkits/allowedTools.',
            inputSchema: SkillCreateInputSchema,
            execute: async (input, context) => {
                const resolvedInput = resolveSkillCreateInput(input);
                const skillId = resolvedInput.id.trim();
                assertValidPromptName(skillId, {
                    context: 'skill_create',
                    hint: 'Use kebab-case skill ids (e.g., release-notes)',
                });

                const { baseDir, scope } = resolveSkillDirectory(resolvedInput, context);
                const skillDir = path.join(baseDir, skillId);
                ensurePathWithinBase(baseDir, skillDir, 'skill_create');

                const skillFile = path.join(skillDir, 'SKILL.md');
                const exists = await pathExists(skillFile);
                if (exists && !resolvedInput.overwrite) {
                    throw ToolError.validationFailed(
                        'skill_create',
                        `Skill already exists at ${skillFile}`
                    );
                }

                const markdown = buildSkillMarkdown(resolvedInput);
                await fs.mkdir(skillDir, { recursive: true });
                await fs.writeFile(skillFile, markdown, 'utf-8');

                const refreshed = await refreshAgentPrompts(context, skillFile);
                const displayName = titleizeSkillId(skillId) || skillId;

                return {
                    created: true,
                    id: skillId,
                    name: displayName,
                    description: resolvedInput.description.trim(),
                    scope,
                    path: skillFile,
                    promptsRefreshed: refreshed,
                };
            },
        });

        const skillUpdateTool = defineTool({
            id: 'skill_update',
            description: 'Update an existing standalone SKILL.md file.',
            inputSchema: SkillUpdateInputSchema,
            execute: async (input, context) => {
                const skillId = input.id.trim();
                assertValidPromptName(skillId, {
                    context: 'skill_update',
                    hint: 'Use kebab-case skill ids (e.g., release-notes)',
                });

                const { baseDir, scope } = await resolveSkillUpdateDirectory(input, context);
                const skillDir = path.join(baseDir, skillId);
                ensurePathWithinBase(baseDir, skillDir, 'skill_update');

                const skillFile = path.join(skillDir, 'SKILL.md');
                const exists = await pathExists(skillFile);
                if (!exists) {
                    throw ToolError.validationFailed(
                        'skill_update',
                        `Skill not found at ${skillFile}`
                    );
                }

                const existing = await readSkillFrontmatter(skillFile);
                const description = input.description?.trim() || existing.description;
                if (!description) {
                    throw ToolError.validationFailed(
                        'skill_update',
                        'description is required when the existing skill is missing one'
                    );
                }

                const allowedTools =
                    input.allowedTools !== undefined ? input.allowedTools : existing.allowedTools;
                const toolkits = input.toolkits !== undefined ? input.toolkits : existing.toolkits;

                const markdown = buildSkillMarkdownFromParts({
                    id: skillId,
                    description,
                    content: input.content.trim(),
                    allowedTools,
                    toolkits,
                });

                await fs.writeFile(skillFile, markdown, 'utf-8');
                const refreshed = await refreshAgentPrompts(context, skillFile);

                return {
                    updated: true,
                    id: skillId,
                    description,
                    scope,
                    path: skillFile,
                    promptsRefreshed: refreshed,
                };
            },
        });

        const skillSearchTool = defineTool({
            id: 'skill_search',
            description: 'Search loaded skills (supports query).',
            inputSchema: SkillSearchInputSchema,
            execute: async (input, context) => {
                const query = input.query?.trim() ?? '';
                const normalizedQuery = normalizeSkillQuery(query);
                const hasQuery = normalizedQuery.length > 0;
                const limit = input.limit ?? (hasQuery ? undefined : 50);
                const promptManager = context.services?.prompts;
                if (!promptManager) {
                    throw ToolError.configInvalid(
                        'skill_search requires ToolExecutionContext.services.prompts'
                    );
                }

                const loaded = await promptManager.list();
                let results: SkillSearchEntry[] = Object.entries(loaded).map(([id, info]) => ({
                    id,
                    name: resolvePromptSkillName(info, id),
                    ...(info.displayName ? { displayName: info.displayName } : {}),
                    ...(info.commandName ? { commandName: info.commandName } : {}),
                    ...(info.description ? { description: info.description } : {}),
                    ...(info.context ? { context: info.context } : {}),
                    ...(info.agent ? { agent: info.agent } : {}),
                }));

                if (hasQuery && normalizedQuery) {
                    results = results.filter((entry) => {
                        if (matchesSkillQuery(entry.id, normalizedQuery)) return true;
                        if (matchesSkillQuery(entry.name, normalizedQuery)) return true;
                        if (matchesSkillQuery(entry.displayName, normalizedQuery)) return true;
                        if (matchesSkillQuery(entry.commandName, normalizedQuery)) return true;
                        if (matchesSkillQuery(entry.description, normalizedQuery)) return true;
                        return false;
                    });
                }

                results.sort((a, b) => a.name.localeCompare(b.name));
                const limited = typeof limit === 'number' ? results.slice(0, limit) : results;

                return {
                    query: input.query?.trim(),
                    count: limited.length,
                    total: results.length,
                    skills: limited,
                    _hint:
                        limited.length > 0
                            ? 'Use invoke_skill with the skill id or commandName for loaded skills.'
                            : 'No skills matched the query.',
                };
            },
        });

        const skillListTool = defineTool({
            id: 'skill_list',
            description:
                'List discovered standalone skills and their search paths. Supports optional query filtering.',
            inputSchema: SkillListInputSchema,
            execute: async (input) => {
                const query = input.query?.trim().toLowerCase();
                const skills = discoverStandaloneSkills(input.projectPath);
                const filtered = query
                    ? skills.filter((skill) => {
                          if (skill.name.toLowerCase().includes(query)) return true;
                          if (skill.path.toLowerCase().includes(query)) return true;
                          if (skill.skillFile.toLowerCase().includes(query)) return true;
                          return false;
                      })
                    : skills;
                return {
                    searchPaths: getSkillSearchPaths(),
                    skills: filtered,
                };
            },
        });

        const toolCatalogTool = defineTool({
            id: 'tool_catalog',
            description:
                'List available tools and configured toolkits for the current agent (from the loaded image/config).',
            inputSchema: ToolCatalogInputSchema,
            execute: async (input, context) => {
                const agent = context.agent;
                if (!agent) {
                    throw ToolError.configInvalid(
                        'tool_catalog requires ToolExecutionContext.agent'
                    );
                }

                const toolSet = await agent.getAllTools();
                let tools: ToolCatalogEntry[] = Object.entries(toolSet).map(([id, tool]) => ({
                    id,
                    description: tool.description || 'No description provided',
                    source: id.startsWith('mcp--') ? 'mcp' : 'local',
                }));

                const query = input.query?.trim().toLowerCase();
                if (query) {
                    tools = tools.filter((tool) => {
                        if (tool.id.toLowerCase().includes(query)) return true;
                        if ((tool.description ?? '').toLowerCase().includes(query)) return true;
                        return false;
                    });
                }

                tools.sort((a, b) => a.id.localeCompare(b.id));

                const includeDescriptions = input.includeDescriptions !== false;
                if (!includeDescriptions) {
                    tools = tools.map((tool) => ({ id: tool.id, source: tool.source }));
                }

                const limited =
                    typeof input.limit === 'number' ? tools.slice(0, input.limit) : tools;

                return {
                    query: input.query?.trim(),
                    count: limited.length,
                    total: tools.length,
                    tools: limited,
                    _hint:
                        limited.length > 0
                            ? 'Use tool ids in allowed-tools. Use toolkits from the agent config or image defaults.'
                            : 'No tools matched the query.',
                };
            },
        });

        const toolCreators: Record<CreatorToolName, () => Tool> = {
            skill_create: () => skillCreateTool,
            skill_update: () => skillUpdateTool,
            skill_search: () => skillSearchTool,
            skill_list: () => skillListTool,
            tool_catalog: () => toolCatalogTool,
        };

        return enabledTools.map((toolName) => toolCreators[toolName]());
    },
};
