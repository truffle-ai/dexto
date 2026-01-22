import type { PromptProvider, PromptInfo, PromptDefinition, PromptListResult } from '../types.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { ValidatedAgentConfig } from '../../agent/schemas.js';
import type { InlinePrompt, FilePrompt, PromptsConfig } from '../schemas.js';
import { PromptsSchema } from '../schemas.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';
import { PromptError } from '../errors.js';
import { expandPlaceholders } from '../utils.js';
import { assertValidPromptName } from '../name-validation.js';
import { readFile, realpath } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, relative, sep } from 'path';

/**
 * Config Prompt Provider - Unified provider for prompts from agent configuration
 *
 * Handles both inline prompts (text defined directly in config) and file-based prompts
 * (loaded from markdown files). This replaces the old StarterPromptProvider and
 * FilePromptProvider with a single, unified approach.
 *
 * Prompts with showInStarters: true are displayed as clickable buttons in the WebUI.
 */
export class ConfigPromptProvider implements PromptProvider {
    private prompts: PromptsConfig = [];
    private promptsCache: PromptInfo[] = [];
    private promptContent: Map<string, string> = new Map();
    private cacheValid: boolean = false;
    private logger: IDextoLogger;

    constructor(agentConfig: ValidatedAgentConfig, logger: IDextoLogger) {
        this.logger = logger.createChild(DextoLogComponent.PROMPT);
        this.prompts = agentConfig.prompts;
        this.buildPromptsCache();
    }

    getSource(): string {
        return 'config';
    }

    invalidateCache(): void {
        this.cacheValid = false;
        this.promptsCache = [];
        this.promptContent.clear();
        this.logger.debug('ConfigPromptProvider cache invalidated');
    }

    updatePrompts(prompts: PromptsConfig): void {
        const result = PromptsSchema.safeParse(prompts);
        if (!result.success) {
            const errorMsg = result.error.issues.map((i) => i.message).join(', ');
            this.logger.error(`Invalid prompts config: ${errorMsg}`);
            throw PromptError.validationFailed(errorMsg);
        }
        this.prompts = result.data;
        this.invalidateCache();
        this.buildPromptsCache();
    }

    async listPrompts(_cursor?: string): Promise<PromptListResult> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        return {
            prompts: this.promptsCache,
        };
    }

    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        const promptInfo = this.promptsCache.find((p) => p.name === name);
        if (!promptInfo) {
            throw PromptError.notFound(name);
        }

        let content = this.promptContent.get(name);
        if (!content) {
            throw PromptError.missingText();
        }

        // Apply arguments
        content = this.applyArguments(content, args);

        return {
            description: promptInfo.description,
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: content,
                    },
                },
            ],
        };
    }

    async getPromptDefinition(name: string): Promise<PromptDefinition | null> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        const promptInfo = this.promptsCache.find((p) => p.name === name);
        if (!promptInfo) {
            return null;
        }

        return {
            name: promptInfo.name,
            ...(promptInfo.title && { title: promptInfo.title }),
            ...(promptInfo.description && { description: promptInfo.description }),
            ...(promptInfo.arguments && { arguments: promptInfo.arguments }),
            // Claude Code compatibility fields
            ...(promptInfo.disableModelInvocation !== undefined && {
                disableModelInvocation: promptInfo.disableModelInvocation,
            }),
            ...(promptInfo.userInvocable !== undefined && {
                userInvocable: promptInfo.userInvocable,
            }),
            ...(promptInfo.allowedTools !== undefined && {
                allowedTools: promptInfo.allowedTools,
            }),
            ...(promptInfo.model !== undefined && { model: promptInfo.model }),
            ...(promptInfo.context !== undefined && { context: promptInfo.context }),
        };
    }

    private async buildPromptsCache(): Promise<void> {
        const cache: PromptInfo[] = [];
        const contentMap = new Map<string, string>();

        for (const prompt of this.prompts ?? []) {
            try {
                if (prompt.type === 'inline') {
                    const { info, content } = this.processInlinePrompt(prompt);
                    cache.push(info);
                    contentMap.set(info.name, content);
                } else if (prompt.type === 'file') {
                    const result = await this.processFilePrompt(prompt);
                    if (result) {
                        cache.push(result.info);
                        contentMap.set(result.info.name, result.content);
                    }
                }
            } catch (error) {
                this.logger.warn(
                    `Failed to process prompt: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        // Sort by priority (higher numbers first)
        cache.sort((a, b) => {
            const priorityA = (a.metadata?.priority as number) ?? 0;
            const priorityB = (b.metadata?.priority as number) ?? 0;
            return priorityB - priorityA;
        });

        this.promptsCache = cache;
        this.promptContent = contentMap;
        this.cacheValid = true;

        this.logger.debug(`Cached ${cache.length} config prompts`);
    }

    private processInlinePrompt(prompt: InlinePrompt): {
        info: PromptInfo;
        content: string;
    } {
        const promptName = `config:${prompt.id}`;
        const promptInfo: PromptInfo = {
            name: promptName,
            displayName: prompt.id,
            title: prompt.title,
            description: prompt.description,
            source: 'config',
            // Claude Code compatibility fields
            disableModelInvocation: prompt['disable-model-invocation'],
            userInvocable: prompt['user-invocable'],
            allowedTools: prompt['allowed-tools'],
            model: prompt.model,
            context: prompt.context,
            metadata: {
                type: 'inline',
                category: prompt.category,
                priority: prompt.priority,
                showInStarters: prompt.showInStarters,
                originalId: prompt.id,
            },
        };

        return { info: promptInfo, content: prompt.prompt };
    }

    private async processFilePrompt(
        prompt: FilePrompt
    ): Promise<{ info: PromptInfo; content: string } | null> {
        const filePath = prompt.file;

        if (!existsSync(filePath)) {
            this.logger.warn(`Prompt file not found: ${filePath}`);
            return null;
        }

        // Security: Validate file path to prevent symlink escapes
        try {
            const resolvedDir = await realpath(dirname(filePath));
            const resolvedFile = await realpath(filePath);

            // Check if resolved file is within the expected directory
            const rel = relative(resolvedDir, resolvedFile);
            if (rel.startsWith('..' + sep) || rel === '..') {
                this.logger.warn(
                    `Skipping prompt file '${filePath}': path traversal attempt detected (resolved outside directory)`
                );
                return null;
            }
        } catch (realpathError) {
            this.logger.warn(
                `Skipping prompt file '${filePath}': unable to resolve path (${realpathError instanceof Error ? realpathError.message : String(realpathError)})`
            );
            return null;
        }

        try {
            const rawContent = await readFile(filePath, 'utf-8');
            const parsed = this.parseMarkdownPrompt(rawContent, filePath);

            // Validate the parsed prompt name
            try {
                assertValidPromptName(parsed.id, {
                    context: `file prompt '${filePath}'`,
                    hint: "Use kebab-case in the 'id:' frontmatter field or file name.",
                });
            } catch (validationError) {
                this.logger.warn(
                    `Invalid prompt name in '${filePath}': ${validationError instanceof Error ? validationError.message : String(validationError)}`
                );
                return null;
            }

            // Config-level fields override frontmatter values
            const disableModelInvocation =
                prompt['disable-model-invocation'] ?? parsed.disableModelInvocation;
            const userInvocable = prompt['user-invocable'] ?? parsed.userInvocable;
            const allowedTools = prompt['allowed-tools'] ?? parsed.allowedTools;
            const model = prompt.model ?? parsed.model;
            const context = prompt.context ?? parsed.context;
            const agent = prompt.agent ?? parsed.agent;

            // Handle namespace prefixing for plugin commands
            const displayName = prompt.namespace ? `${prompt.namespace}:${parsed.id}` : parsed.id;
            const promptName = prompt.namespace
                ? `config:${prompt.namespace}:${parsed.id}`
                : `config:${parsed.id}`;

            const promptInfo: PromptInfo = {
                name: promptName,
                displayName,
                title: parsed.title,
                description: parsed.description,
                source: 'config',
                ...(parsed.arguments && { arguments: parsed.arguments }),
                // Claude Code compatibility fields
                ...(disableModelInvocation !== undefined && { disableModelInvocation }),
                ...(userInvocable !== undefined && { userInvocable }),
                ...(allowedTools !== undefined && { allowedTools }),
                ...(model !== undefined && { model }),
                ...(context !== undefined && { context }),
                ...(agent !== undefined && { agent }),
                metadata: {
                    type: 'file',
                    filePath: filePath,
                    category: parsed.category,
                    priority: parsed.priority,
                    showInStarters: prompt.showInStarters,
                    originalId: parsed.id,
                    ...(prompt.namespace && { namespace: prompt.namespace }),
                },
            };

            return { info: promptInfo, content: parsed.content };
        } catch (error) {
            this.logger.warn(
                `Failed to read prompt file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
            );
            return null;
        }
    }

    private parseMarkdownPrompt(
        rawContent: string,
        filePath: string
    ): {
        id: string;
        title: string;
        description: string;
        content: string;
        category?: string;
        priority?: number;
        arguments?: Array<{ name: string; required: boolean; description?: string }>;
        // Claude Code compatibility fields
        disableModelInvocation?: boolean;
        userInvocable?: boolean;
        allowedTools?: string[];
        model?: string;
        context?: 'inline' | 'fork';
        agent?: string;
    } {
        const lines = rawContent.trim().split('\n');
        const pathParts = filePath.split('/');
        const fileName = pathParts.pop()?.replace(/\.md$/, '') ?? 'unknown';

        // For SKILL.md files, use parent directory name as the id (Claude Code convention)
        // e.g., .claude/skills/my-skill/SKILL.md -> id = "my-skill"
        const defaultId =
            fileName.toUpperCase() === 'SKILL'
                ? (pathParts[pathParts.length - 1] ?? fileName)
                : fileName;

        let id = defaultId;
        let title = defaultId;
        let description = `File prompt: ${defaultId}`;
        let category: string | undefined;
        let priority: number | undefined;
        let argumentHint: string | undefined;
        // Claude Code compatibility fields
        let disableModelInvocation: boolean | undefined;
        let userInvocable: boolean | undefined;
        let allowedTools: string[] | undefined;
        let model: string | undefined;
        let context: 'inline' | 'fork' | undefined;
        let agent: string | undefined;
        let contentBody: string;

        // Parse frontmatter if present
        if (lines[0]?.trim() === '---') {
            let frontmatterEnd = 0;
            for (let i = 1; i < lines.length; i++) {
                if (lines[i]?.trim() === '---') {
                    frontmatterEnd = i;
                    break;
                }
            }

            if (frontmatterEnd > 0) {
                const frontmatterLines = lines.slice(1, frontmatterEnd);
                contentBody = lines.slice(frontmatterEnd + 1).join('\n');

                for (const line of frontmatterLines) {
                    const match = (key: string) => {
                        const regex = new RegExp(`${key}:\\s*(?:['"](.+)['"]|(.+))`);
                        const m = line.match(regex);
                        return m ? (m[1] || m[2] || '').trim() : null;
                    };

                    const matchBool = (key: string): boolean | undefined => {
                        const val = match(key);
                        if (val === 'true') return true;
                        if (val === 'false') return false;
                        return undefined;
                    };

                    if (line.includes('id:')) {
                        const val = match('id');
                        if (val) id = val;
                    } else if (line.includes('name:') && !line.includes('display-name:')) {
                        // Claude Code SKILL.md uses 'name:' instead of 'id:'
                        // Only use if id hasn't been explicitly set via 'id:' field
                        const val = match('name');
                        if (val && id === defaultId) id = val;
                    } else if (line.includes('title:')) {
                        const val = match('title');
                        if (val) title = val;
                    } else if (line.includes('description:')) {
                        const val = match('description');
                        if (val) description = val;
                    } else if (line.includes('category:')) {
                        const val = match('category');
                        if (val) category = val;
                    } else if (line.includes('priority:')) {
                        const val = match('priority');
                        if (val) priority = parseInt(val, 10);
                    } else if (line.includes('argument-hint:')) {
                        const val = match('argument-hint');
                        if (val) argumentHint = val;
                    } else if (line.includes('disable-model-invocation:')) {
                        disableModelInvocation = matchBool('disable-model-invocation');
                    } else if (line.includes('user-invocable:')) {
                        userInvocable = matchBool('user-invocable');
                    } else if (line.includes('model:')) {
                        const val = match('model');
                        if (val) model = val;
                    } else if (line.includes('context:')) {
                        const val = match('context');
                        if (val === 'fork' || val === 'inline') context = val;
                    } else if (line.includes('agent:')) {
                        const val = match('agent');
                        if (val) agent = val;
                    }
                    // Note: allowed-tools parsing requires special handling for arrays
                    // Will be parsed as YAML array in a separate pass below
                }

                // Parse allowed-tools as YAML array (simple format: [item1, item2] or multiline)
                const frontmatterText = frontmatterLines.join('\n');
                const allowedToolsMatch = frontmatterText.match(/allowed-tools:\s*\[([^\]]+)\]/);
                if (allowedToolsMatch?.[1]) {
                    allowedTools = allowedToolsMatch[1]
                        .split(',')
                        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
                        .filter((s) => s.length > 0);
                }
            } else {
                contentBody = rawContent;
            }
        } else {
            contentBody = rawContent;
        }

        // Extract title from first heading if not in frontmatter
        if (title === defaultId) {
            for (const line of contentBody.trim().split('\n')) {
                if (line.trim().startsWith('#')) {
                    title = line.trim().replace(/^#+\s*/, '');
                    break;
                }
            }
        }

        // Parse argument hints into structured arguments
        const parsedArguments = argumentHint ? this.parseArgumentHint(argumentHint) : undefined;

        return {
            id,
            title,
            description,
            content: contentBody.trim(),
            ...(category !== undefined && { category }),
            ...(priority !== undefined && { priority }),
            ...(parsedArguments !== undefined && { arguments: parsedArguments }),
            ...(disableModelInvocation !== undefined && { disableModelInvocation }),
            ...(userInvocable !== undefined && { userInvocable }),
            ...(allowedTools !== undefined && { allowedTools }),
            ...(model !== undefined && { model }),
            ...(context !== undefined && { context }),
            ...(agent !== undefined && { agent }),
        };
    }

    private parseArgumentHint(
        hint: string
    ): Array<{ name: string; required: boolean; description?: string }> {
        const args: Array<{ name: string; required: boolean; description?: string }> = [];
        const argPattern = /\[([^\]]+)\]/g;
        let match;

        while ((match = argPattern.exec(hint)) !== null) {
            const argText = match[1];
            if (!argText) continue;

            const isOptional = argText.endsWith('?');
            const name = isOptional ? argText.slice(0, -1).trim() : argText.trim();

            if (name) {
                args.push({
                    name,
                    required: !isOptional,
                });
            }
        }

        return args;
    }

    private applyArguments(content: string, args?: Record<string, unknown>): string {
        // Detect whether content uses positional placeholders
        const detectionTarget = content.replaceAll('$$', '');
        const usesPositionalPlaceholders =
            /\$[1-9](?!\d)/.test(detectionTarget) || detectionTarget.includes('$ARGUMENTS');

        // First expand positional placeholders
        const expanded = expandPlaceholders(content, args).trim();

        if (!args || typeof args !== 'object' || Object.keys(args).length === 0) {
            return expanded;
        }

        // If the prompt doesn't use placeholders, append formatted arguments
        if (!usesPositionalPlaceholders) {
            if ((args as Record<string, unknown>)._context) {
                const contextString = String((args as Record<string, unknown>)._context);
                return `${expanded}\n\nContext: ${contextString}`;
            }

            const argEntries = Object.entries(args).filter(([key]) => !key.startsWith('_'));
            if (argEntries.length > 0) {
                const formattedArgs = argEntries
                    .map(([key, value]) => `${key}: ${value}`)
                    .join(', ');
                return `${expanded}\n\nArguments: ${formattedArgs}`;
            }
        }

        return expanded;
    }
}
