import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolFactory } from '@dexto/agent-config';
import {
    ToolError,
    defineTool,
    assertValidPromptName,
    type Tool,
    type ToolExecutionContext,
    type SkillSummary,
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
 * - skill refresh so skills are immediately available
 * - scope-aware paths (workspace/global)
 */
const SkillCreateInputSchema = z
    .object({
        id: z.string().min(1).describe('Skill id (kebab-case).'),
        description: z.string().min(1).describe('Short description of what the skill does.'),
        content: z.string().min(1).describe('Skill body (markdown) without frontmatter.'),
        scope: z.enum(['global', 'workspace']).optional(),
        overwrite: z.boolean().optional(),
    })
    .strict();

const SkillUpdateInputSchema = z
    .object({
        id: z.string().min(1),
        content: z.string().min(1).describe('New SKILL.md body (markdown) without frontmatter.'),
        description: z.string().min(1).optional(),
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

const SkillRefreshInputSchema = z
    .object({
        id: z.string().min(1).describe('Skill id to refresh in the running agent session.'),
        scope: z.enum(['global', 'workspace']).optional(),
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
};

type ToolCatalogEntry = {
    id: string;
    description?: string;
    source: 'local' | 'mcp';
};

const SKILL_RESOURCE_DIRECTORIES = ['handlers', 'scripts', 'mcps', 'references'] as const;

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

function resolveSkillName(info: SkillSummary): string {
    return info.displayName || info.id;
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
    secondary: string;
    legacy: string;
} {
    const base = resolveWorkspaceBasePath(context);
    return {
        primary: path.join(base, 'skills'),
        secondary: path.join(base, '.agents', 'skills'),
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
    input: {
        id: string;
        scope?: 'global' | 'workspace' | undefined;
    },
    context: ToolExecutionContext
): Promise<{ baseDir: string; scope: 'global' | 'workspace' }> {
    if (input.scope === 'global') {
        return resolveSkillBaseDirectory('global', context);
    }

    const { primary, secondary, legacy } = resolveWorkspaceSkillDirs(context);
    const skillId = input.id.trim();
    const primaryFile = path.join(primary, skillId, 'SKILL.md');
    if (await pathExists(primaryFile)) {
        return { baseDir: primary, scope: 'workspace' };
    }

    const secondaryFile = path.join(secondary, skillId, 'SKILL.md');
    if (await pathExists(secondaryFile)) {
        return { baseDir: secondary, scope: 'workspace' };
    }

    const legacyFile = path.join(legacy, skillId, 'SKILL.md');
    if (await pathExists(legacyFile)) {
        return { baseDir: legacy, scope: 'workspace' };
    }

    return { baseDir: primary, scope: 'workspace' };
}

async function resolveExistingSkillLocation(
    input: {
        id: string;
        scope?: 'global' | 'workspace' | undefined;
    },
    context: ToolExecutionContext
): Promise<{
    baseDir: string;
    scope: 'global' | 'workspace';
    skillDir: string;
    skillFile: string;
}> {
    const { baseDir, scope } = await resolveSkillUpdateDirectory(input, context);
    const skillDir = path.join(baseDir, input.id.trim());
    ensurePathWithinBase(baseDir, skillDir, 'skill_refresh');
    const skillFile = path.join(skillDir, 'SKILL.md');
    return {
        baseDir,
        scope,
        skillDir,
        skillFile,
    };
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

function buildSkillMarkdownFromParts(options: {
    id: string;
    description: string;
    content: string;
}): string {
    const id = options.id.trim();
    const title = titleizeSkillId(id) || id;
    const body = normalizeSkillBody(options.content);
    const lines: string[] = ['---'];

    lines.push(formatFrontmatterLine('name', id));
    lines.push(formatFrontmatterLine('description', options.description.trim()));

    lines.push('---', '', `# ${title}`);
    if (body.length > 0) {
        lines.push('', body);
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function normalizeSkillBody(content: string): string {
    const trimmed = content.trim();
    const withoutFrontmatter = trimmed.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trimStart();
    const withoutLeadingH1 = withoutFrontmatter.replace(/^#\s+[^\n]+(?:\n+|$)/, '').trimStart();
    return withoutLeadingH1.trim();
}

function buildSkillMarkdown(input: ResolvedSkillCreateInput): string {
    return buildSkillMarkdownFromParts({
        id: input.id,
        description: input.description,
        content: input.content,
    });
}

function frontmatterDescription(markdown: string): string | undefined {
    if (!markdown.startsWith('---\n')) return undefined;
    const end = markdown.indexOf('\n---', 4);
    if (end < 0) return undefined;
    const line = markdown
        .slice(4, end)
        .split('\n')
        .find((candidate) => candidate.trim().startsWith('description:'));
    return line?.split(':').slice(1).join(':').trim().replace(/^"|"$/g, '') || undefined;
}

async function readSkillDescription(skillFile: string): Promise<string | undefined> {
    try {
        const raw = await fs.readFile(skillFile, 'utf-8');
        return frontmatterDescription(raw);
    } catch {
        return undefined;
    }
}

async function refreshAgentSkills(context: ToolExecutionContext): Promise<boolean> {
    const skillManager = context.services?.skills;
    if (!skillManager) return false;
    await skillManager.refresh();
    return true;
}

function inspectSkillBundle(): {
    notes: string[];
} {
    return {
        notes: [
            'Files under mcps/ are inert bundled files. Configure MCP servers through normal MCP configuration paths.',
            'After editing SKILL.md or bundled files with non-creator tools, run skill_refresh so the current session sees the latest skill content.',
        ],
    };
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
                'Create a standalone SKILL.md file, scaffold bundled resource directories, and register it with the running agent. Files under mcps/ are inert bundled files.',
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
                await Promise.all(
                    SKILL_RESOURCE_DIRECTORIES.map((directory) =>
                        fs.mkdir(path.join(skillDir, directory), { recursive: true })
                    )
                );

                const refreshed = await refreshAgentSkills(context);
                const displayName = titleizeSkillId(skillId) || skillId;
                const bundleDetails = inspectSkillBundle();

                return {
                    created: true,
                    id: skillId,
                    name: displayName,
                    description: resolvedInput.description.trim(),
                    scope,
                    path: skillFile,
                    resourceDirectories: SKILL_RESOURCE_DIRECTORIES.map((directory) =>
                        path.join(skillDir, directory)
                    ),
                    skillsRefreshed: refreshed,
                    ...bundleDetails,
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

                const { scope, skillFile } = await resolveExistingSkillLocation(input, context);
                const exists = await pathExists(skillFile);
                if (!exists) {
                    throw ToolError.validationFailed(
                        'skill_update',
                        `Skill not found at ${skillFile}`
                    );
                }

                const existingDescription = await readSkillDescription(skillFile);
                const description = input.description?.trim() || existingDescription;
                if (!description) {
                    throw ToolError.validationFailed(
                        'skill_update',
                        'description is required when the existing skill is missing one'
                    );
                }

                const markdown = buildSkillMarkdownFromParts({
                    id: skillId,
                    description,
                    content: input.content.trim(),
                });

                await fs.writeFile(skillFile, markdown, 'utf-8');
                const refreshed = await refreshAgentSkills(context);
                const bundleDetails = inspectSkillBundle();

                return {
                    updated: true,
                    id: skillId,
                    description,
                    scope,
                    path: skillFile,
                    skillsRefreshed: refreshed,
                    ...bundleDetails,
                };
            },
        });

        const skillRefreshTool = defineTool({
            id: 'skill_refresh',
            description:
                'Refresh one standalone skill bundle in the current session after editing SKILL.md, handlers/, scripts/, mcps/, or references/.',
            inputSchema: SkillRefreshInputSchema,
            execute: async (input, context) => {
                const skillId = input.id.trim();
                assertValidPromptName(skillId, {
                    context: 'skill_refresh',
                    hint: 'Use kebab-case skill ids (e.g., release-notes)',
                });

                if (!context.services?.skills) {
                    throw ToolError.configInvalid(
                        'skill_refresh requires ToolExecutionContext.services.skills'
                    );
                }

                const { scope, skillFile } = await resolveExistingSkillLocation(input, context);
                const exists = await pathExists(skillFile);
                if (!exists) {
                    throw ToolError.validationFailed(
                        'skill_refresh',
                        `Skill not found at ${skillFile}`
                    );
                }

                const refreshed = await refreshAgentSkills(context);
                const bundleDetails = inspectSkillBundle();

                return {
                    refreshed: true,
                    id: skillId,
                    scope,
                    path: skillFile,
                    skillsRefreshed: refreshed,
                    ...bundleDetails,
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
                const skillManager = context.services?.skills;
                if (!skillManager) {
                    throw ToolError.configInvalid(
                        'skill_search requires ToolExecutionContext.services.skills'
                    );
                }

                const loaded = await skillManager.list();
                let results: SkillSearchEntry[] = loaded.map((info) => ({
                    id: info.id,
                    name: resolveSkillName(info),
                    ...(info.description ? { description: info.description } : {}),
                }));

                if (hasQuery && normalizedQuery) {
                    results = results.filter((entry) => {
                        if (matchesSkillQuery(entry.id, normalizedQuery)) return true;
                        if (matchesSkillQuery(entry.name, normalizedQuery)) return true;
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
                            ? 'Use exact tool ids when configuring agent permissions.'
                            : 'No tools matched the query.',
                };
            },
        });

        const toolCreators: Record<CreatorToolName, () => Tool> = {
            skill_create: () => skillCreateTool,
            skill_update: () => skillUpdateTool,
            skill_refresh: () => skillRefreshTool,
            skill_search: () => skillSearchTool,
            skill_list: () => skillListTool,
            tool_catalog: () => toolCatalogTool,
        };

        return enabledTools.map((toolName) => toolCreators[toolName]());
    },
};
