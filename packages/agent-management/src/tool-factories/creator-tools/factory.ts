import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ToolFactory } from '@dexto/agent-config';
import {
    ToolError,
    TOOL_ACTIVITY,
    defineTool,
    assertValidPromptName,
    type Tool,
    type ToolExecutionContext,
} from '@dexto/core';
import {
    discoverStandaloneSkills,
    getSkillSearchPaths,
    getStandaloneSkillPaths,
} from '../../plugins/discover-skills.js';
import { getSkillFrontmatter } from '../../plugins/skill-markdown.js';
import {
    CREATOR_TOOL_NAMES,
    CreatorToolsConfigSchema,
    type CreatorToolName,
    type CreatorToolsConfig,
} from './schemas.js';
import { z } from 'zod';

/**
 * Creator tools handle SKILL.md lifecycle with guardrails beyond raw file writes:
 * - validation (ids + inputs)
 * - safety (path confinement)
 * - consistent frontmatter shaping
 * - exact canonical names for skill lookup
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
        id: z.string().min(1).describe('Skill id to re-read in the running agent session.'),
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

function resolveWorkspaceSkillsDirectory(context: ToolExecutionContext): string {
    const base = resolveWorkspaceBasePath(context);
    return getStandaloneSkillPaths(base).project;
}

function resolveGlobalSkillsDirectory(): string {
    return getStandaloneSkillPaths().user;
}

function resolveSkillSearchDirectories(
    scope: SkillScope,
    context: ToolExecutionContext
): readonly string[] {
    const paths =
        scope === 'global'
            ? getStandaloneSkillPaths()
            : getStandaloneSkillPaths(resolveWorkspaceBasePath(context));

    return scope === 'global'
        ? [paths.user, ...paths.legacyUser]
        : [paths.project, ...paths.legacyProject];
}

type SkillScope = 'global' | 'workspace';

function resolveSkillBaseDirectory(
    scope: SkillScope | undefined,
    context: ToolExecutionContext
): { baseDir: string; scope: SkillScope } {
    if (scope === 'global') {
        return { baseDir: resolveGlobalSkillsDirectory(), scope: 'global' };
    }

    return { baseDir: resolveWorkspaceSkillsDirectory(context), scope: 'workspace' };
}

function resolveSkillDirectory(
    input: z.output<typeof SkillCreateInputSchema>,
    context: ToolExecutionContext
): { baseDir: string; scope: SkillScope } {
    return resolveSkillBaseDirectory(input.scope, context);
}

async function pathExists(filePath: string): Promise<boolean> {
    return await fs
        .lstat(filePath)
        .then(() => true)
        .catch(() => false);
}

async function isSafeExistingSkillFile(baseDir: string, skillFile: string): Promise<boolean> {
    try {
        const [fileStat, physicalBaseDir, physicalSkillFile] = await Promise.all([
            fs.lstat(skillFile),
            fs.realpath(baseDir),
            fs.realpath(skillFile),
        ]);
        if (!fileStat.isFile() || fileStat.isSymbolicLink()) return false;

        const relativePath = path.relative(physicalBaseDir, physicalSkillFile);
        return (
            relativePath.length > 0 &&
            relativePath !== '..' &&
            !relativePath.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relativePath)
        );
    } catch {
        return false;
    }
}

function resolveSkillUpdateDirectory(
    input: {
        id: string;
        scope?: 'global' | 'workspace' | undefined;
    },
    context: ToolExecutionContext
): { baseDir: string; scope: SkillScope } {
    return resolveSkillBaseDirectory(input.scope, context);
}

async function resolveExistingSkillLocation(
    input: {
        id: string;
        scope?: 'global' | 'workspace' | undefined;
    },
    context: ToolExecutionContext,
    toolId: 'skill_update' | 'skill_refresh'
): Promise<{
    baseDir: string;
    scope: 'global' | 'workspace';
    skillDir: string;
    skillFile: string;
}> {
    const { baseDir, scope } = resolveSkillUpdateDirectory(input, context);
    const searchDirectories = resolveSkillSearchDirectories(scope, context);

    for (const searchDirectory of searchDirectories) {
        const skillDir = path.join(searchDirectory, input.id.trim());
        ensurePathWithinBase(searchDirectory, skillDir, toolId);
        const skillFile = path.join(skillDir, 'SKILL.md');
        if (await isSafeExistingSkillFile(searchDirectory, skillFile)) {
            return {
                baseDir: searchDirectory,
                scope,
                skillDir,
                skillFile,
            };
        }
    }

    const skillDir = path.join(baseDir, input.id.trim());
    ensurePathWithinBase(baseDir, skillDir, toolId);
    return {
        baseDir,
        scope,
        skillDir,
        skillFile: path.join(skillDir, 'SKILL.md'),
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

async function readSkillDescription(skillFile: string): Promise<string | undefined> {
    try {
        const raw = await fs.readFile(skillFile, 'utf-8');
        return getSkillFrontmatter(raw).description;
    } catch {
        return undefined;
    }
}

async function checkSkillAvailable(context: ToolExecutionContext, name: string): Promise<boolean> {
    const skills = context.services?.skills;
    if (!skills) return false;
    return (await skills.load(name)) !== null;
}

function inspectSkillBundle(): {
    notes: string[];
} {
    return {
        notes: [
            'Files under mcps/ are inert bundled files. Configure MCP servers through normal MCP configuration paths.',
            'Skills are read from their current files, so edits are visible to the next skill_load call.',
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
            presentation: { activity: TOOL_ACTIVITY.createSkill },
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

                const skillsAvailable = await checkSkillAvailable(context, skillId);
                const bundleDetails = inspectSkillBundle();

                return {
                    created: true,
                    id: skillId,
                    name: skillId,
                    description: resolvedInput.description.trim(),
                    scope,
                    path: skillFile,
                    resourceDirectories: SKILL_RESOURCE_DIRECTORIES.map((directory) =>
                        path.join(skillDir, directory)
                    ),
                    skillsAvailable,
                    ...bundleDetails,
                };
            },
        });

        const skillUpdateTool = defineTool({
            id: 'skill_update',
            description: 'Update an existing standalone SKILL.md file.',
            inputSchema: SkillUpdateInputSchema,
            presentation: { activity: TOOL_ACTIVITY.updateSkill },
            execute: async (input, context) => {
                const skillId = input.id.trim();
                assertValidPromptName(skillId, {
                    context: 'skill_update',
                    hint: 'Use kebab-case skill ids (e.g., release-notes)',
                });

                const { scope, skillFile } = await resolveExistingSkillLocation(
                    input,
                    context,
                    'skill_update'
                );
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
                const skillsAvailable = await checkSkillAvailable(context, skillId);
                const bundleDetails = inspectSkillBundle();

                return {
                    updated: true,
                    id: skillId,
                    description,
                    scope,
                    path: skillFile,
                    skillsAvailable,
                    ...bundleDetails,
                };
            },
        });

        const skillRefreshTool = defineTool({
            id: 'skill_refresh',
            description:
                'Re-read one standalone skill bundle in the current session after editing SKILL.md, handlers/, scripts/, mcps/, or references/.',
            inputSchema: SkillRefreshInputSchema,
            presentation: { activity: TOOL_ACTIVITY.refreshSkill },
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

                const { scope, skillFile } = await resolveExistingSkillLocation(
                    input,
                    context,
                    'skill_refresh'
                );
                const exists = await pathExists(skillFile);
                if (!exists) {
                    throw ToolError.validationFailed(
                        'skill_refresh',
                        `Skill not found at ${skillFile}`
                    );
                }

                const skillsAvailable = await checkSkillAvailable(context, skillId);
                const bundleDetails = inspectSkillBundle();

                return {
                    refreshed: true,
                    id: skillId,
                    scope,
                    path: skillFile,
                    skillsAvailable,
                    ...bundleDetails,
                };
            },
        });

        const skillSearchTool = defineTool({
            id: 'skill_search',
            description: 'Search loaded skills (supports query).',
            inputSchema: SkillSearchInputSchema,
            presentation: { activity: TOOL_ACTIVITY.searchSkills },
            execute: async (input, context) => {
                const query = input.query?.trim() ?? '';
                const normalizedQuery = normalizeSkillQuery(query);
                const hasQuery = normalizedQuery.length > 0;
                const limit = input.limit ?? (hasQuery ? undefined : 50);
                const skills = context.services?.skills;
                if (!skills) {
                    throw ToolError.configInvalid(
                        'skill_search requires ToolExecutionContext.services.skills'
                    );
                }

                const loaded = await skills.list();
                let results = [...loaded];

                if (hasQuery && normalizedQuery) {
                    results = results.filter((entry) => {
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
                            ? 'Use skill_load with the exact name for a matching skill.'
                            : 'No skills matched the query.',
                };
            },
        });

        const skillListTool = defineTool({
            id: 'skill_list',
            description:
                'List discovered standalone skills and their search paths. Supports optional query filtering.',
            inputSchema: SkillListInputSchema,
            presentation: { activity: TOOL_ACTIVITY.searchSkills },
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
                    searchPaths: getSkillSearchPaths(input.projectPath),
                    skills: filtered,
                };
            },
        });

        const toolCatalogTool = defineTool({
            id: 'tool_catalog',
            description:
                'List available tools and configured toolkits for the current agent (from the loaded image/config).',
            inputSchema: ToolCatalogInputSchema,
            presentation: { activity: TOOL_ACTIVITY.discoverTools },
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
