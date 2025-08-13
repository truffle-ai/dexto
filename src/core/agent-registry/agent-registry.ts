/**
 * Agent Registry Implementation
 * Handles resolution of agent names to configuration paths
 */

import { existsSync, writeFileSync, readFileSync, mkdirSync, readdirSync, rmSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { logger } from '@core/logger/index.js';
import { getDextoPath } from '@core/utils/path.js';
import { resolveBundledScript } from '@core/utils/path.js';
import {
    AgentRegistry,
    AgentRegistryEntry,
    AgentRegistryConfig,
    AgentRegistryConfigSchema,
    RawAgentData,
    RawAgentDataSchema,
} from './types.js';

/**
 * Check if a string is a URL
 */
function isUrl(str: string): boolean {
    try {
        new URL(str);
        return true;
    } catch {
        return false;
    }
}

/**
 * Parse GitHub URL to extract repository information
 */
interface GitHubUrlInfo {
    user: string;
    repo: string;
    branch: string;
    path: string;
    type: 'file' | 'directory';
    isGitHub: boolean;
}

function parseGitHubUrl(url: string): GitHubUrlInfo | null {
    try {
        const urlObj = new URL(url);

        if (urlObj.hostname !== 'github.com') {
            return null;
        }

        const pathParts = urlObj.pathname.split('/').filter(Boolean);

        // Minimum: /user/repo
        if (pathParts.length < 2) {
            return null;
        }

        const userPart = pathParts[0];
        const repoPart = pathParts[1];
        if (
            typeof userPart !== 'string' ||
            typeof repoPart !== 'string' ||
            !userPart ||
            !repoPart
        ) {
            return null;
        }
        const user: string = userPart;
        const repo: string = repoPart;

        // Handle different GitHub URL patterns:
        // /user/repo/blob/branch/file.yml (file)
        // /user/repo/tree/branch/folder (directory)
        // /user/repo/tree/branch/folder/file.yml (file in directory)

        let branch: string = 'main'; // default
        let path: string = '';
        let type: 'file' | 'directory' = 'file';

        if (pathParts.length >= 4) {
            if (pathParts[2] === 'blob') {
                // File URL: /user/repo/blob/branch/path/to/file.yml
                type = 'file';
                const branchCandidate = pathParts[3];
                if (typeof branchCandidate === 'string' && branchCandidate.length > 0) {
                    branch = branchCandidate;
                }
                path = pathParts.slice(4).join('/');
            } else if (pathParts[2] === 'tree') {
                // Directory URL: /user/repo/tree/branch/path/to/folder
                type = 'directory';
                const branchCandidate = pathParts[3];
                if (typeof branchCandidate === 'string' && branchCandidate.length > 0) {
                    branch = branchCandidate;
                }
                path = pathParts.slice(4).join('/');
            }
        }

        return {
            user,
            repo,
            branch,
            path,
            type,
            isGitHub: true,
        };
    } catch (error) {
        logger.debug(`Failed to parse GitHub URL ${url}: ${error}`);
        return null;
    }
}

/**
 * Convert GitHub blob URLs to raw URLs for direct file access
 */
function normalizeGitHubUrl(url: string): string {
    const parsed = parseGitHubUrl(url);

    if (!parsed || parsed.type !== 'file') {
        return url;
    }

    const rawUrl = `https://raw.githubusercontent.com/${parsed.user}/${parsed.repo}/${parsed.branch}/${parsed.path}`;
    logger.debug(`Converted GitHub blob URL to raw URL: ${url} → ${rawUrl}`);
    return rawUrl;
}

/**
 * Check if a string looks like a file path
 * More robust than just checking for dots to avoid false positives with agent names like "search.v1"
 */
function isPath(str: string): boolean {
    // Check for absolute paths first
    if (path.isAbsolute(str)) {
        return true;
    }

    // Check for path separators (relative paths)
    if (/[\\/]/.test(str)) {
        return true;
    }

    // Check for file extensions (but not just any dot)
    if (/\.(ya?ml|json)$/i.test(str)) {
        return true;
    }

    return false;
}

export class LocalAgentRegistry implements AgentRegistry {
    private config: AgentRegistryConfig;
    private _registryAgents: Record<string, AgentRegistryEntry> | null = null;

    constructor(config?: Partial<AgentRegistryConfig>) {
        this.config = AgentRegistryConfigSchema.parse(config || {});
    }

    /**
     * Lazy load registry agents from JSON file
     */
    private getRegistryAgents(): Record<string, AgentRegistryEntry> {
        if (this._registryAgents === null) {
            this._registryAgents = this.loadRegistryAgents();
        }
        return this._registryAgents;
    }

    /**
     * Load registry agents from JSON file and convert to AgentRegistryEntry format
     */
    private loadRegistryAgents(): Record<string, AgentRegistryEntry> {
        let jsonPath: string;

        try {
            // Use bundled script resolution for proper path handling
            jsonPath = resolveBundledScript('agents/agent-registry.json');
        } catch (error) {
            logger.error(`Failed to resolve agent registry path: ${error}`);
            return {};
        }

        if (!existsSync(jsonPath)) {
            logger.debug(`Agent registry not found at: ${jsonPath}`);
            return {};
        }

        try {
            const jsonData = readFileSync(jsonPath, 'utf-8');
            const rawAgents: Record<string, unknown> = JSON.parse(jsonData);

            const agents: Record<string, AgentRegistryEntry> = {};

            for (const [key, rawAgentData] of Object.entries(rawAgents)) {
                // Validate raw agent data
                let validatedRawAgent: RawAgentData;
                try {
                    validatedRawAgent = RawAgentDataSchema.parse(rawAgentData);
                } catch (error) {
                    logger.debug(`Failed to parse agent '${key}' in registry: ${error}`);
                    continue; // Skip this agent if it doesn't match the schema
                }

                // Resolve config file path using bundled script resolution
                let configPath: string;
                try {
                    configPath = resolveBundledScript(`agents/${validatedRawAgent.configFile}`);
                } catch (error) {
                    logger.debug(`Failed to resolve config for agent '${key}': ${error}`);
                    continue; // Skip this agent if config can't be resolved
                }

                // Create final registry entry with resolved config path
                const entry: AgentRegistryEntry = {
                    ...validatedRawAgent,
                    configFile: configPath,
                };

                agents[key] = entry;
            }

            return agents;
        } catch (error) {
            logger.error(`Failed to load registry agents from ${jsonPath}: ${error}`);
            return {};
        }
    }

    /**
     * Check if a name corresponds to a registry agent
     */
    private isRegistryAgent(name: string): boolean {
        return name in this.getRegistryAgents();
    }

    /**
     * Get a registry agent by name
     */
    private getRegistryAgent(name: string): AgentRegistryEntry | null {
        return this.getRegistryAgents()[name] || null;
    }

    /**
     * Download and cache a GitHub directory
     */
    private async downloadAndCacheDirectory(
        url: string,
        githubInfo: GitHubUrlInfo
    ): Promise<string> {
        try {
            // Create cache directory
            const cacheDir = getDextoPath('cache', 'agents');
            if (!existsSync(cacheDir)) {
                mkdirSync(cacheDir, { recursive: true });
            }

            // Generate cache directory name from URL using SHA-256 hash
            const urlHash = createHash('sha256').update(url).digest('hex');
            const cacheDirPath = path.join(cacheDir, urlHash);
            const metaFile = path.join(cacheDirPath, '.meta.json');

            // Check if cached version exists and is still valid
            if (existsSync(cacheDirPath) && existsSync(metaFile)) {
                try {
                    const meta = JSON.parse(readFileSync(metaFile, 'utf-8'));
                    const cacheAge = Date.now() - meta.timestamp;

                    if (cacheAge < this.config.cacheTtl! * 1000) {
                        logger.debug(`Using cached directory: ${cacheDirPath}`);
                        // Return path to the main YAML file
                        const mainYaml = path.join(cacheDirPath, 'agent.yml');
                        if (existsSync(mainYaml)) {
                            return mainYaml;
                        }
                        // Fallback to first .yml file found
                        const files = readdirSync(cacheDirPath);
                        const yamlFile = files.find(
                            (f: string) => f.endsWith('.yml') || f.endsWith('.yaml')
                        );
                        if (yamlFile) {
                            return path.join(cacheDirPath, yamlFile);
                        }
                    }
                } catch (error) {
                    logger.debug(`Cache meta file corrupted, re-downloading: ${error}`);
                }
            }

            // Download fresh copy using GitHub API
            logger.info(`Downloading directory from GitHub: ${url}`);

            const apiUrl = `https://api.github.com/repos/${githubInfo.user}/${githubInfo.repo}/contents/${githubInfo.path}?ref=${githubInfo.branch}`;
            const response = await fetch(apiUrl, {
                headers: {
                    Accept: 'application/vnd.github.v3+json',
                    'User-Agent': 'dexto-agent-registry',
                },
            });

            if (!response.ok) {
                throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
            }

            const contents = await response.json();

            if (!Array.isArray(contents)) {
                throw new Error('GitHub path is not a directory');
            }

            // Create cache directory
            if (existsSync(cacheDirPath)) {
                // Remove existing cache
                rmSync(cacheDirPath, { recursive: true, force: true });
            }
            mkdirSync(cacheDirPath, { recursive: true });

            let mainConfigFile: string | null = null;

            // Download all files in the directory
            for (const item of contents) {
                if (item.type === 'file') {
                    logger.debug(`Downloading file: ${item.name}`);

                    const fileResponse = await fetch(item.download_url);
                    if (!fileResponse.ok) {
                        logger.warn(`Failed to download ${item.name}: ${fileResponse.status}`);
                        continue;
                    }

                    const fileContent = await fileResponse.text();
                    const filePath = path.join(cacheDirPath, item.name);
                    writeFileSync(filePath, fileContent, 'utf-8');

                    // Track main config file (prefer agent.yml, then first .yml file)
                    if (item.name === 'agent.yml' || item.name === 'agent.yaml') {
                        mainConfigFile = filePath;
                    } else if (
                        !mainConfigFile &&
                        (item.name.endsWith('.yml') || item.name.endsWith('.yaml'))
                    ) {
                        mainConfigFile = filePath;
                    }
                }
            }

            if (!mainConfigFile) {
                throw new Error('No YAML configuration file found in directory');
            }

            // Save metadata
            writeFileSync(
                metaFile,
                JSON.stringify({
                    url,
                    timestamp: Date.now(),
                    type: 'directory',
                    mainConfig: path.basename(mainConfigFile),
                }),
                'utf-8'
            );

            logger.debug(`Cached directory: ${cacheDirPath}, main config: ${mainConfigFile}`);
            return mainConfigFile;
        } catch (error) {
            throw new Error(
                `Failed to download directory from ${url}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Download and cache a remote agent configuration
     */
    private async downloadAndCacheConfig(url: string): Promise<string> {
        try {
            // Create cache directory
            const cacheDir = getDextoPath('cache', 'agents');
            if (!existsSync(cacheDir)) {
                mkdirSync(cacheDir, { recursive: true });
            }

            // Generate cache filename from URL using SHA-256 hash
            const urlHash = createHash('sha256').update(url).digest('hex');
            const cacheFile = path.join(cacheDir, `${urlHash}.yml`);
            const metaFile = path.join(cacheDir, `${urlHash}.meta.json`);

            // Check if cached version exists and is still valid
            if (existsSync(cacheFile) && existsSync(metaFile)) {
                try {
                    const meta = JSON.parse(readFileSync(metaFile, 'utf-8'));
                    const cacheAge = Date.now() - meta.timestamp;

                    if (cacheAge < this.config.cacheTtl! * 1000) {
                        logger.debug(`Using cached agent config: ${cacheFile}`);
                        return cacheFile;
                    }
                } catch (error) {
                    logger.warn(
                        `Cache metadata corrupted for ${url}, cleaning up and re-downloading: ${error}`
                    );
                    // Clean up corrupted cache files to avoid mixing stale artifacts
                    try {
                        if (existsSync(cacheFile)) {
                            rmSync(cacheFile);
                        }
                        if (existsSync(metaFile)) {
                            rmSync(metaFile);
                        }
                    } catch (cleanupError) {
                        logger.debug(`Failed to clean up corrupted cache files: ${cleanupError}`);
                    }
                }
            }

            // Download fresh copy
            logger.info(`Downloading agent config from: ${url}`);
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const content = await response.text();

            // Save to cache
            writeFileSync(cacheFile, content, 'utf-8');
            writeFileSync(
                metaFile,
                JSON.stringify({
                    url,
                    timestamp: Date.now(),
                    size: content.length,
                }),
                'utf-8'
            );

            logger.debug(`Cached agent config: ${cacheFile}`);
            return cacheFile;
        } catch (error) {
            throw new Error(
                `Failed to download agent config from ${url}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * List all available agents in the registry
     */
    async listAgents(): Promise<AgentRegistryEntry[]> {
        const agents: AgentRegistryEntry[] = [];

        // Add registry agents
        for (const agent of Object.values(this.getRegistryAgents())) {
            // For local paths, verify the config file exists
            if (existsSync(agent.configFile)) {
                agents.push(agent);
            } else {
                logger.debug(`Registry agent config not found: ${agent.configFile}`);
            }
        }

        return agents.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Get a specific agent by name
     */
    async getAgent(name: string): Promise<AgentRegistryEntry | null> {
        // Check registry agents first
        const registryAgent = this.getRegistryAgent(name);
        if (registryAgent) {
            // For local paths, verify the config file exists
            if (existsSync(registryAgent.configFile)) {
                return registryAgent;
            }
        }

        return null;
    }

    /**
     * Check if an agent exists in the registry
     */
    async hasAgent(name: string): Promise<boolean> {
        const agent = await this.getAgent(name);
        return agent !== null;
    }

    /**
     * Resolve an agent name, URL, or path to a configuration file path
     *
     * Resolution order:
     * 1. If it's a URL (starts with http/https), download and cache it
     * 2. If it's a registry agent name, return the registry config path
     * 3. If it's an absolute file path that exists, return it as-is
     * 4. If it's a relative path, resolve it relative to cwd
     * 5. Throw error if nothing matches
     */
    async resolveAgent(nameOrPath: string): Promise<string> {
        logger.debug(`Resolving agent: ${nameOrPath}`);

        // 1. Check if it's a URL - download and cache it
        if (isUrl(nameOrPath)) {
            // Mark remote URL resolution as experimental for DX clarity
            logger.warn(
                `Experimental: resolving agent from remote URL '${nameOrPath}'. ` +
                    `Please use only for trusted sources.`
            );
            try {
                const githubInfo = parseGitHubUrl(nameOrPath);

                if (githubInfo && githubInfo.type === 'directory') {
                    // Handle GitHub directory URLs
                    const cachedPath = await this.downloadAndCacheDirectory(nameOrPath, githubInfo);
                    logger.debug(
                        `Resolved directory URL '${nameOrPath}' to cached file: ${cachedPath}`
                    );
                    return cachedPath;
                } else {
                    // Handle single file URLs (existing behavior)
                    const normalizedUrl = normalizeGitHubUrl(nameOrPath);
                    const cachedPath = await this.downloadAndCacheConfig(normalizedUrl);
                    logger.debug(`Resolved URL '${nameOrPath}' to cached file: ${cachedPath}`);
                    return cachedPath;
                }
            } catch (error) {
                throw new Error(
                    `Failed to download agent from URL '${nameOrPath}': ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        // 2. Check if it's a registry agent name
        if (this.isRegistryAgent(nameOrPath)) {
            const agent = this.getRegistryAgent(nameOrPath);
            if (agent && existsSync(agent.configFile)) {
                logger.debug(`Resolved registry agent '${nameOrPath}' to: ${agent.configFile}`);
                return agent.configFile;
            }
        }

        // 3. Check if it's an absolute path that exists
        if (path.isAbsolute(nameOrPath) && existsSync(nameOrPath)) {
            logger.debug(`Using absolute path: ${nameOrPath}`);
            return nameOrPath;
        }

        // 4. Check if it's a relative path that exists (resolve from cwd)
        if (isPath(nameOrPath)) {
            const resolvedPath = path.resolve(nameOrPath);
            if (existsSync(resolvedPath)) {
                logger.debug(`Resolved relative path '${nameOrPath}' to: ${resolvedPath}`);
                return resolvedPath;
            }
        }

        // 5. Nothing found - throw error with helpful message
        const availableAgents = Object.keys(this.getRegistryAgents());
        throw new Error(
            `Agent '${nameOrPath}' not found. ` +
                `Available registry agents: ${availableAgents.join(', ')}. ` +
                `You can also provide: a file path to an agent configuration, or a URL to download one.`
        );
    }
}

// Default global registry instance
let defaultRegistry: LocalAgentRegistry | null = null;

/**
 * Get the default agent registry instance
 */
export function getDefaultAgentRegistry(): LocalAgentRegistry {
    if (!defaultRegistry) {
        defaultRegistry = new LocalAgentRegistry();
    }
    return defaultRegistry;
}

/**
 * Convenience function to resolve an agent name/path using the default registry
 */
export async function resolveAgentConfig(nameOrPath: string): Promise<string> {
    const registry = getDefaultAgentRegistry();
    return await registry.resolveAgent(nameOrPath);
}
