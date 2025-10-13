import type { PromptProvider, PromptInfo, PromptDefinition, PromptListResult } from '../types.js';
import { expandPlaceholders } from '../utils.js';
import { assertValidPromptName } from '../name-validation.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../../logger/index.js';
import { PromptError } from '../errors.js';
import { readFile, readdir, realpath } from 'fs/promises';
import { join, extname, resolve, relative, sep } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { findDextoProjectRoot, findDextoSourceRoot } from '../../utils/execution-context.js';
import type { ResourceManager } from '../../resources/manager.js';

interface FilePromptProviderOptions {
    resourceManager: ResourceManager;
}

interface ParsedPrompt {
    info: PromptInfo;
    content: string;
}

// TODO: (355) Might not actually need FilePromptProvider, seems equivalent to starter-prompt-provider with a hardcoded directory. Can keep for now but basically we can add file based prompt providers instead (refer to relative file colocated near the agent)
// https://github.com/truffle-ai/dexto/pull/355#discussion_r2413151059
export class FilePromptProvider implements PromptProvider {
    // Multiple command directories (local project/repo and global user dir)
    private readonly commandDirs: string[];
    private readonly resourceManager: ResourceManager;
    private promptsCache: PromptInfo[] = [];
    private cacheValid = false;
    private promptResources: Map<string, string> = new Map();
    private inlineContent: Map<string, string> = new Map();

    constructor(options: FilePromptProviderOptions) {
        // Opinionated resolution only; no external configuration
        // - <repo_or_project_root>/commands
        // - ~/.dexto/commands (global)
        this.commandDirs = this.resolveDefaultCommandDirs();
        this.resourceManager = options.resourceManager;
    }

    getSource(): string {
        return 'file';
    }

    invalidateCache(): void {
        this.cacheValid = false;
        this.promptsCache = [];
        this.promptResources.clear();
        this.inlineContent.clear();
        logger.debug('FilePromptProvider cache invalidated');
    }

    async getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        const prompt = this.promptsCache.find((p) => p.name === name);
        if (!prompt) {
            throw PromptError.notFound(name);
        }

        const resourceUri = this.promptResources.get(name);
        let text = this.inlineContent.get(name) ?? '';

        if (resourceUri) {
            try {
                const result = await this.resourceManager.read(resourceUri);
                const first = result.contents[0];
                if (first?.text && typeof first.text === 'string') {
                    text = first.text;
                } else if (first?.blob && typeof first.blob === 'string') {
                    text = Buffer.from(first.blob, 'base64').toString('utf-8');
                } else {
                    logger.warn(`Prompt ${name} resource ${resourceUri} did not contain text`);
                }
            } catch (error) {
                logger.warn(
                    `Failed to load prompt resource ${resourceUri}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        if (!text) {
            throw PromptError.missingText();
        }

        const resolved = this.applyArguments(text, args);

        return {
            description: prompt.description,
            messages: [
                {
                    role: 'user',
                    content: {
                        type: 'text',
                        text: resolved,
                    },
                },
            ],
        };
    }

    async listPrompts(_cursor?: string): Promise<PromptListResult> {
        if (!this.cacheValid) {
            await this.buildPromptsCache();
        }

        return {
            prompts: this.promptsCache,
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
        };
    }

    private async buildPromptsCache(): Promise<void> {
        const cache: PromptInfo[] = [];
        const resourceMap: Map<string, string> = new Map();
        const inlineMap: Map<string, string> = new Map();
        const seenNames = new Set<string>();

        const scannedDirs: string[] = [];

        for (const dir of this.commandDirs) {
            if (!existsSync(dir)) {
                continue;
            }
            try {
                scannedDirs.push(dir);
                const files = await readdir(dir);
                const markdownFiles = files.filter((file) => extname(file).toLowerCase() === '.md');

                for (const file of markdownFiles) {
                    try {
                        // Security: Validate file path to prevent directory traversal and symlink escapes
                        // Use realpath to resolve symlinks to their actual targets
                        try {
                            const candidate = join(dir, file);
                            const resolvedDir = await realpath(dir);
                            const resolvedFile = await realpath(candidate);

                            // Check if resolved file is within the allowed directory
                            const rel = relative(resolvedDir, resolvedFile);
                            if (rel.startsWith('..' + sep) || rel === '..') {
                                logger.warn(
                                    `Skipping file '${file}' in '${dir}': path traversal attempt detected (resolved outside directory)`
                                );
                                continue;
                            }
                        } catch (realpathError) {
                            // If realpath fails (file doesn't exist, permission denied, etc.), skip it
                            logger.warn(
                                `Skipping file '${file}' in '${dir}': unable to resolve path (${realpathError instanceof Error ? realpathError.message : String(realpathError)})`
                            );
                            continue;
                        }

                        const parsed = await this.parsePromptFile(file, dir);
                        if (seenNames.has(parsed.info.name)) {
                            // Prefer the first occurrence (local overrides global)
                            logger.debug(
                                `Skipping duplicate prompt name '${parsed.info.name}' from ${join(
                                    dir,
                                    file
                                )}`
                            );
                            continue;
                        }
                        const storage = await this.storePromptContent(parsed.content, file);
                        if (storage.resourceUri) {
                            resourceMap.set(parsed.info.name, storage.resourceUri);
                        }
                        if (storage.inlineContent) {
                            inlineMap.set(parsed.info.name, storage.inlineContent);
                        }

                        if (storage.resourceUri || storage.inlineContent) {
                            const metadata = {
                                ...(parsed.info.metadata ?? {}),
                                ...(storage.resourceUri && { resourceUri: storage.resourceUri }),
                                // Security: Don't expose absolute sourceDir path
                                // The relative filePath in parsed.info.metadata is sufficient
                            } as Record<string, unknown>;
                            if (Object.keys(metadata).length > 0) {
                                parsed.info = { ...parsed.info, metadata };
                            } else {
                                parsed.info = { ...parsed.info };
                                delete parsed.info.metadata;
                            }
                        }

                        cache.push(parsed.info);
                        seenNames.add(parsed.info.name);
                    } catch (error) {
                        logger.warn(
                            `Failed to process prompt file '${file}' in '${dir}': ${
                                error instanceof Error ? error.message : String(error)
                            }`
                        );
                    }
                }
            } catch (error) {
                logger.debug(
                    `Commands directory '${dir}' not accessible: ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            }
        }

        logger.debug(
            `📝 Cached ${cache.length} file prompts from directories: ${scannedDirs.join(', ')}`
        );

        this.promptsCache = cache;
        this.promptResources = resourceMap;
        this.inlineContent = inlineMap;
        this.cacheValid = true;
    }

    private async parsePromptFile(fileName: string, baseDir: string): Promise<ParsedPrompt> {
        const promptName = fileName.replace(/\.md$/, '');
        const filePath = join(baseDir, fileName);
        const content = await readFile(filePath, 'utf-8');

        const lines = content.trim().split('\n');
        let description = `File prompt: ${promptName}`;
        let title = promptName;
        let category: string | undefined;
        let id: string | undefined;
        let nameOverride: string | undefined;
        let argumentHint: string | undefined;
        let contentBody: string | undefined;

        if (lines[0]?.trim() === '---') {
            let inFrontmatter = false;
            let frontmatterEnd = 0;

            for (let i = 0; i < lines.length; i++) {
                if (lines[i]?.trim() === '---') {
                    if (!inFrontmatter) {
                        inFrontmatter = true;
                    } else {
                        frontmatterEnd = i;
                        break;
                    }
                }
            }

            if (frontmatterEnd > 0) {
                const frontmatterLines = lines.slice(1, frontmatterEnd);
                contentBody = lines.slice(frontmatterEnd + 1).join('\n');

                for (const line of frontmatterLines) {
                    if (line.includes('description:')) {
                        // Match: description: value OR description: "value" OR description: 'value'
                        // Handles quotes inside the value properly
                        const descMatch = line.match(/description:\s*(?:['"](.+)['"]|(.+))/);
                        if (descMatch) {
                            description = (descMatch[1] || descMatch[2] || '').trim();
                        }
                    } else if (line.includes('id:')) {
                        const idMatch = line.match(/id:\s*(?:['"](.+)['"]|(.+))/);
                        if (idMatch) {
                            id = (idMatch[1] || idMatch[2] || '').trim();
                        }
                    } else if (line.includes('name:')) {
                        const nameMatch = line.match(/name:\s*(?:['"](.+)['"]|(.+))/);
                        if (nameMatch) {
                            nameOverride = (nameMatch[1] || nameMatch[2] || '').trim();
                        }
                    } else if (line.includes('category:')) {
                        const categoryMatch = line.match(/category:\s*(?:['"](.+)['"]|(.+))/);
                        if (categoryMatch) {
                            category = (categoryMatch[1] || categoryMatch[2] || '').trim();
                        }
                    } else if (line.includes('argument-hint:')) {
                        const hintMatch = line.match(/argument-hint:\s*(?:['"](.+)['"]|(.+))/);
                        if (hintMatch) {
                            argumentHint = (hintMatch[1] || hintMatch[2] || '').trim();
                        }
                    }
                }
            }
        }

        if (!contentBody) {
            contentBody = content;
        }

        const bodyLines = contentBody.trim().split('\n');
        for (const line of bodyLines) {
            if (line.trim().startsWith('#')) {
                title = line.trim().replace(/^#+\s*/, '');
                break;
            }
        }

        const finalName = (nameOverride ?? promptName).trim();
        assertValidPromptName(finalName, {
            hint: "Use kebab-case in the 'name:' field or file name.",
        });

        // Parse argument-hint into structured arguments array
        // Format: [arg1] [arg2?] → array of {name, required}
        const parsedArguments = argumentHint ? this.parseArgumentHint(argumentHint) : undefined;

        // Security: Use relative path to avoid exposing user's filesystem layout
        // Compute relative to the base directory, not cwd, to avoid exposing ~/.dexto structure
        const relativePath = relative(baseDir, filePath);

        const promptInfo: PromptInfo = {
            name: finalName,
            title,
            description,
            source: 'file',
            ...(parsedArguments && { arguments: parsedArguments }),
            metadata: {
                originalName: promptName,
                fileName,
                // Only include relative path within the commands directory (e.g., "my-command.md")
                // not the full path which could expose ~/.dexto or project structure
                ...(relativePath && { filePath: relativePath }),
                ...(id && { id }),
                ...(category && { category }),
            },
        };

        return { info: promptInfo, content: contentBody };
    }

    /**
     * Parse argument-hint string into structured argument definitions
     * Format: "[style] [length?]" → [{name: "style", required: true}, {name: "length", required: false}]
     */
    private parseArgumentHint(
        hint: string
    ): Array<{ name: string; required: boolean; description?: string }> {
        const args: Array<{ name: string; required: boolean; description?: string }> = [];

        // Match [argname] or [argname?]
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

    private async storePromptContent(
        content: string,
        fileName: string
    ): Promise<{ resourceUri?: string; inlineContent?: string }> {
        const blobService = this.resourceManager.getBlobStore();
        if (!blobService) {
            logger.warn('BlobService not available; storing prompt content in memory');
            return { inlineContent: content };
        }

        const blobInput = Buffer.from(content, 'utf-8');

        const blob = await blobService.store(blobInput, {
            mimeType: 'text/markdown',
            originalName: fileName,
            source: 'system',
        });

        return { resourceUri: blob.uri };
    }

    /**
     * Apply arguments to a file prompt's content.
     *
     * Behavior mirrors Claude Code-style file prompts:
     * - Positional placeholders ($1..$9 and $ARGUMENTS) are expanded first.
     * - If and only if the template contains explicit placeholders ($1..$9 or $ARGUMENTS),
     *   then we consider arguments "deconstructed in-template" and DO NOT append them again.
     * - If the template contains no such placeholders, we append either:
     *   - `Context: <_context>` above the content when `_context` is provided, or
     *   - `Arguments: key: value, ...` below the content for plain named args.
     *
     * Notes:
     * - The `$$` sequence is an escape for a literal dollar sign. It MUST NOT be
     *   treated as a placeholder indicator and should not suppress argument appending.
     */
    private applyArguments(content: string, args?: Record<string, unknown>): string {
        // Detect whether content uses positional placeholders. DO NOT treat `$$` as placeholder usage.
        // Strip escaped dollars first to avoid false positives
        const detectionTarget = content.replaceAll('$$', '');
        // Use negative lookahead to avoid matching $1 in $10, $11, etc.
        const usesPositionalPlaceholders =
            /\$[1-9](?!\d)/.test(detectionTarget) || detectionTarget.includes('$ARGUMENTS');

        // First expand positional placeholders ($ARGUMENTS, $1..$9, $$)
        const expanded = expandPlaceholders(content, args).trim();

        if (!args || typeof args !== 'object' || Object.keys(args).length === 0) {
            return expanded;
        }

        // If the prompt doesn't use placeholders, append formatted arguments
        // so they're available to the LLM even without explicit placeholder syntax
        if (!usesPositionalPlaceholders) {
            // Handle _context separately (for natural language after slash commands)
            if ((args as any)._context) {
                const contextString = String((args as any)._context);
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

    // Determine default command/prompt directories based on execution context
    private resolveDefaultCommandDirs(): string[] {
        const dirs: string[] = [];

        // Try to find dexto source or a dexto-using project root
        const sourceRoot = findDextoSourceRoot();
        const projectRoot = findDextoProjectRoot();
        const localRoot = sourceRoot ?? projectRoot ?? null;

        if (localRoot) {
            const commandsDir = resolve(localRoot, 'commands');
            if (existsSync(commandsDir)) dirs.push(commandsDir);
        }

        // Global user commands directory
        const globalCommands = resolve(homedir(), '.dexto', 'commands');
        if (existsSync(globalCommands)) dirs.push(globalCommands);

        // If nothing exists yet, still return preferred order so that subsequent
        // checks log clearly which paths are attempted.
        if (dirs.length === 0) {
            if (localRoot) {
                dirs.push(resolve(localRoot, 'commands'));
            }
            dirs.push(globalCommands);
        }

        return dirs;
    }
}
