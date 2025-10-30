import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { DextoAgent } from '@dexto/core';
import {
    Dexto,
    deriveDisplayName,
    LLM_PROVIDERS,
    getPrimaryApiKeyEnvVar,
    saveProviderApiKey,
    logger,
    type LLMProvider,
} from '@dexto/core';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { AgentConfigSchema } from '@dexto/core';
import { DextoValidationError, AgentErrorCode, ErrorScope, ErrorType } from '@dexto/core';

const AgentIdentifierSchema = z
    .object({
        id: z
            .string()
            .min(1, 'Agent id is required')
            .describe('Unique agent identifier (e.g., "database-agent")'),
        path: z
            .string()
            .optional()
            .describe(
                'Optional absolute file path for file-based agents (e.g., "/path/to/agent.yml")'
            ),
    })
    .strict();

const UninstallAgentSchema = z
    .object({
        id: z
            .string()
            .min(1, 'Agent id is required')
            .describe('Unique agent identifier to uninstall'),
        force: z
            .boolean()
            .default(false)
            .describe('Force uninstall even if agent is currently active'),
    })
    .strict();

const CustomAgentInstallSchema = z
    .object({
        id: z.string().min(1, 'Agent id is required').describe('Unique agent identifier'),
        name: z.string().optional().describe('Display name (defaults to derived from id)'),
        sourcePath: z.string().min(1).describe('Path to agent configuration file or directory'),
        metadata: z
            .object({
                description: z.string().min(1).describe('Human-readable description of the agent'),
                author: z.string().min(1).describe('Agent author or organization name'),
                tags: z.array(z.string()).describe('Tags for categorizing the agent'),
                main: z
                    .string()
                    .optional()
                    .describe('Main configuration file name within source directory'),
            })
            .strict(),
        injectPreferences: z
            .boolean()
            .default(true)
            .describe('Whether to inject user preferences into agent config'),
    })
    .strict()
    .transform((value) => {
        const displayName = value.name?.trim() || deriveDisplayName(value.id);
        return {
            id: value.id,
            displayName,
            sourcePath: value.sourcePath,
            metadata: value.metadata,
            injectPreferences: value.injectPreferences,
        };
    });

const CustomAgentCreateSchema = z
    .object({
        id: z
            .string()
            .min(1, 'Agent ID is required')
            .regex(
                /^[a-z0-9-]+$/,
                'Agent ID must contain only lowercase letters, numbers, and hyphens'
            )
            .describe('Unique agent identifier'),
        name: z.string().min(1, 'Agent name is required').describe('Display name for the agent'),
        description: z
            .string()
            .min(1, 'Description is required')
            .describe('One-line description of the agent'),
        author: z.string().optional().describe('Author or organization'),
        tags: z.array(z.string()).default([]).describe('Tags for discovery'),
        llm: z
            .object({
                provider: z.enum(LLM_PROVIDERS).describe('LLM provider id'),
                model: z.string().min(1, 'Model is required').describe('Model name'),
                apiKey: z
                    .string()
                    .optional()
                    .describe('API key or environment variable reference (e.g., $OPENAI_API_KEY)'),
            })
            .strict()
            .describe('LLM configuration'),
        systemPrompt: z
            .string()
            .min(1, 'System prompt is required')
            .describe('System prompt for the agent'),
    })
    .strict();

const AgentConfigValidateSchema = z.object({
    yaml: z.string().min(1, 'YAML content is required'),
});

const AgentConfigSaveSchema = z.object({
    yaml: z.string().min(1, 'YAML content is required'),
});

export type AgentsRouterContext = {
    switchAgentById: (agentId: string) => Promise<{ id: string; name: string }>;
    switchAgentByPath: (filePath: string) => Promise<{ id: string; name: string }>;
    resolveAgentInfo: (agentId: string) => Promise<{ id: string; name: string }>;
    ensureAgentAvailable: () => void;
    getActiveAgentId: () => string | undefined;
};

export function createAgentsRouter(getAgent: () => DextoAgent, context: AgentsRouterContext) {
    const app = new OpenAPIHono();
    const {
        switchAgentById,
        switchAgentByPath,
        resolveAgentInfo,
        ensureAgentAvailable,
        getActiveAgentId,
    } = context;

    const listRoute = createRoute({
        method: 'get',
        path: '/agents',
        tags: ['agents'],
        responses: {
            200: {
                description: 'List all agents',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(listRoute, async (ctx) => {
        const agents = await Dexto.listAgents();
        const currentId = getActiveAgentId() ?? null;
        return ctx.json({
            installed: agents.installed,
            available: agents.available,
            current: currentId ? await resolveAgentInfo(currentId) : { id: null, name: null },
        });
    });

    const currentRoute = createRoute({
        method: 'get',
        path: '/agents/current',
        tags: ['agents'],
        responses: {
            200: {
                description: 'Current agent',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(currentRoute, async (ctx) => {
        const currentId = getActiveAgentId() ?? null;
        if (!currentId) {
            return ctx.json({ id: null, name: null });
        }
        return ctx.json(await resolveAgentInfo(currentId));
    });

    const installRoute = createRoute({
        method: 'post',
        path: '/agents/install',
        tags: ['agents'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: z.union([CustomAgentInstallSchema, AgentIdentifierSchema]),
                    },
                },
            },
        },
        responses: {
            201: {
                description: 'Agent installed',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(installRoute, async (ctx) => {
        const body = ctx.req.valid('json');

        // Check if this is a custom agent installation (has sourcePath and metadata)
        if ('sourcePath' in body && 'metadata' in body) {
            const { id, displayName, sourcePath, metadata, injectPreferences } = body as ReturnType<
                typeof CustomAgentInstallSchema.parse
            >;

            await Dexto.installCustomAgent(
                id,
                sourcePath,
                {
                    name: displayName,
                    description: metadata.description,
                    author: metadata.author,
                    tags: metadata.tags,
                    ...(metadata.main ? { main: metadata.main } : {}),
                },
                injectPreferences
            );
            return ctx.json({ installed: true, id, name: displayName, type: 'custom' }, 201);
        } else {
            // Registry agent installation
            const { id } = body as z.infer<typeof AgentIdentifierSchema>;
            await Dexto.installAgent(id);
            const agentInfo = await resolveAgentInfo(id);
            return ctx.json(
                {
                    installed: true,
                    ...agentInfo,
                    type: 'builtin',
                },
                201
            );
        }
    });

    const switchRoute = createRoute({
        method: 'post',
        path: '/agents/switch',
        tags: ['agents'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: AgentIdentifierSchema,
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Agent switched',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(switchRoute, async (ctx) => {
        const { id, path: filePath } = ctx.req.valid('json');

        // Route based on presence of path parameter
        const result = filePath ? await switchAgentByPath(filePath) : await switchAgentById(id);

        return ctx.json({ switched: true, ...result });
    });

    const validateNameRoute = createRoute({
        method: 'post',
        path: '/agents/validate-name',
        tags: ['agents'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: AgentIdentifierSchema,
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Name validation result',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(validateNameRoute, async (ctx) => {
        const { id } = ctx.req.valid('json');
        const agents = await Dexto.listAgents();

        // Check if name exists in installed agents
        const installedAgent = agents.installed.find((a) => a.id === id);
        if (installedAgent) {
            return ctx.json({
                valid: false,
                conflict: installedAgent.type,
                message: `Agent id '${id}' already exists (${installedAgent.type})`,
            });
        }

        // Check if name exists in available agents (registry)
        const availableAgent = agents.available.find((a) => a.id === id);
        if (availableAgent) {
            return ctx.json({
                valid: false,
                conflict: availableAgent.type,
                message: `Agent id '${id}' conflicts with ${availableAgent.type} agent`,
            });
        }

        return ctx.json({ valid: true });
    });

    const uninstallRoute = createRoute({
        method: 'post',
        path: '/agents/uninstall',
        tags: ['agents'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: UninstallAgentSchema,
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Agent uninstalled',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(uninstallRoute, async (ctx) => {
        const { id, force } = ctx.req.valid('json');
        await Dexto.uninstallAgent(id, force);
        return ctx.json({ uninstalled: true, id });
    });

    const customCreateRoute = createRoute({
        method: 'post',
        path: '/agents/custom/create',
        tags: ['agents'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: CustomAgentCreateSchema,
                    },
                },
            },
        },
        responses: {
            201: {
                description: 'Custom agent created',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(customCreateRoute, async (ctx) => {
        const { id, name, description, author, tags, llm, systemPrompt } = ctx.req.valid('json');

        const provider: LLMProvider = llm.provider;

        // Handle API key: if it's a raw key, store securely and use env var reference
        let apiKeyRef: string | undefined;
        if (llm.apiKey && !llm.apiKey.startsWith('$')) {
            // Raw API key provided - store securely and get env var reference
            const meta = await saveProviderApiKey(provider, llm.apiKey, process.cwd());
            apiKeyRef = `$${meta.envVar}`;
            logger.info(`Stored API key securely for ${provider}, using env var: ${meta.envVar}`);
        } else if (llm.apiKey) {
            // Already an env var reference
            apiKeyRef = llm.apiKey;
        }

        // Create agent YAML content (with env var reference instead of raw key)
        const agentConfig = {
            llm: {
                provider,
                model: llm.model,
                apiKey: apiKeyRef || `$${getPrimaryApiKeyEnvVar(provider)}`,
            },
            systemPrompt,
        };

        const yamlContent = yamlStringify(agentConfig);
        logger.info(`Creating agent config for ${id}:`, { agentConfig, yamlContent });

        // Create temporary file
        const tmpDir = os.tmpdir();
        const tmpFile = path.join(tmpDir, `${id}-${Date.now()}.yml`);
        await fs.writeFile(tmpFile, yamlContent, 'utf-8');

        try {
            // Install the custom agent
            await Dexto.installCustomAgent(
                id,
                tmpFile,
                {
                    name,
                    description,
                    author: author || 'Custom',
                    tags: tags || [],
                },
                false // Don't inject preferences
            );

            // Clean up temp file
            await fs.unlink(tmpFile).catch(() => {});

            return ctx.json({ created: true, id, name }, 201);
        } catch (installError) {
            // Clean up temp file on error
            await fs.unlink(tmpFile).catch(() => {});
            throw installError;
        }
    });

    // Agent Config routes
    const getPathRoute = createRoute({
        method: 'get',
        path: '/agent/path',
        tags: ['agent'],
        responses: {
            200: {
                description: 'Agent file path',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(getPathRoute, (ctx) => {
        const agent = getAgent();
        const agentPath = agent.getAgentFilePath();

        const relativePath = path.basename(agentPath);
        const ext = path.extname(agentPath);
        const name = path.basename(agentPath, ext);

        return ctx.json({
            path: agentPath,
            relativePath,
            name,
            isDefault: name === 'default-agent',
        });
    });

    const getConfigRoute = createRoute({
        method: 'get',
        path: '/agent/config',
        tags: ['agent'],
        responses: {
            200: {
                description: 'Agent configuration',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(getConfigRoute, async (ctx) => {
        const agent = getAgent();

        // Get the agent file path being used
        const agentPath = agent.getAgentFilePath();

        // Read raw YAML from file (not expanded env vars)
        const yamlContent = await fs.readFile(agentPath, 'utf-8');

        // Get metadata
        const stats = await fs.stat(agentPath);

        return ctx.json({
            yaml: yamlContent,
            path: agentPath,
            relativePath: path.basename(agentPath),
            lastModified: stats.mtime,
            warnings: [
                'Environment variables ($VAR) will be resolved at runtime',
                'API keys should use environment variables',
            ],
        });
    });

    const validateConfigRoute = createRoute({
        method: 'post',
        path: '/agent/validate',
        tags: ['agent'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: AgentConfigValidateSchema,
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Validation result',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(validateConfigRoute, async (ctx) => {
        const { yaml } = ctx.req.valid('json');

        // Parse YAML
        let parsed;
        try {
            parsed = yamlParse(yaml);
        } catch (parseError: any) {
            return ctx.json({
                valid: false,
                errors: [
                    {
                        line: parseError.linePos?.[0]?.line || 1,
                        column: parseError.linePos?.[0]?.col || 1,
                        message: parseError.message,
                        code: 'YAML_PARSE_ERROR',
                    },
                ],
                warnings: [],
            });
        }

        // Validate against schema
        const result = AgentConfigSchema.safeParse(parsed);

        if (!result.success) {
            const errors = result.error.errors.map((err) => ({
                path: err.path.join('.'),
                message: err.message,
                code: 'SCHEMA_VALIDATION_ERROR',
            }));

            return ctx.json({
                valid: false,
                errors,
                warnings: [],
            });
        }

        // Check for warnings (e.g., plain text API keys)
        const warnings: Array<{ path: string; message: string; code: string }> = [];
        if (parsed.llm?.apiKey && !parsed.llm.apiKey.startsWith('$')) {
            warnings.push({
                path: 'llm.apiKey',
                message: 'Consider using environment variable instead of plain text',
                code: 'SECURITY_WARNING',
            });
        }

        return ctx.json({
            valid: true,
            errors: [],
            warnings,
        });
    });

    const saveConfigRoute = createRoute({
        method: 'post',
        path: '/agent/config',
        tags: ['agent'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: AgentConfigSaveSchema,
                    },
                },
            },
        },
        responses: {
            200: {
                description: 'Configuration saved',
                content: { 'application/json': { schema: z.any() } },
            },
        },
    });
    app.openapi(saveConfigRoute, async (ctx) => {
        const agent = getAgent();
        const { yaml } = ctx.req.valid('json');

        // Validate YAML syntax first
        let parsed;
        try {
            parsed = yamlParse(yaml);
        } catch (parseError: any) {
            throw new DextoValidationError([
                {
                    code: AgentErrorCode.INVALID_CONFIG,
                    message: `Invalid YAML syntax: ${parseError.message}`,
                    scope: ErrorScope.AGENT,
                    type: ErrorType.USER,
                    severity: 'error',
                },
            ]);
        }

        // Validate schema
        const validationResult = AgentConfigSchema.safeParse(parsed);

        if (!validationResult.success) {
            throw new DextoValidationError(
                validationResult.error.errors.map((err) => ({
                    code: AgentErrorCode.INVALID_CONFIG,
                    message: `${err.path.join('.')}: ${err.message}`,
                    scope: ErrorScope.AGENT,
                    type: ErrorType.USER,
                    severity: 'error',
                }))
            );
        }

        // Get target file path
        const agentPath = agent.getAgentFilePath();

        // Create backup
        const backupPath = `${agentPath}.backup`;
        await fs.copyFile(agentPath, backupPath);

        try {
            // Write new config
            await fs.writeFile(agentPath, yaml, 'utf-8');

            // Reload configuration to detect what changed
            const reloadResult = await agent.reloadConfig();

            // If any changes require restart, automatically restart the agent
            if (reloadResult.restartRequired.length > 0) {
                logger.info(
                    `Auto-restarting agent to apply changes: ${reloadResult.restartRequired.join(', ')}`
                );

                await agent.restart();
                logger.info('Agent restarted successfully with all event subscribers reconnected');
            }

            // Clean up backup file after successful save
            await fs.unlink(backupPath).catch(() => {
                // Ignore errors if backup file doesn't exist
            });

            logger.info(`Agent configuration saved and applied: ${agentPath}`);

            return ctx.json({
                ok: true,
                path: agentPath,
                reloaded: true,
                restarted: reloadResult.restartRequired.length > 0,
                changesApplied: reloadResult.restartRequired,
                message:
                    reloadResult.restartRequired.length > 0
                        ? 'Configuration saved and applied successfully (agent restarted)'
                        : 'Configuration saved successfully (no changes detected)',
            });
        } catch (error) {
            // Restore backup on error
            await fs.copyFile(backupPath, agentPath).catch(() => {
                // Ignore errors if backup restore fails
            });
            throw error;
        }
    });

    const exportConfigRoute = createRoute({
        method: 'get',
        path: '/agent/config/export',
        tags: ['agent'],
        request: {
            query: z.object({
                sessionId: z.string().optional(),
            }),
        },
        responses: {
            200: {
                description: 'Exported configuration',
                content: { 'application/x-yaml': { schema: z.string() } },
            },
        },
    });
    app.openapi(exportConfigRoute, async (ctx) => {
        const agent = getAgent();
        const { sessionId } = ctx.req.valid('query');
        const config = agent.getEffectiveConfig(sessionId);

        // Redact sensitive values
        const maskedConfig = {
            ...config,
            llm: {
                ...config.llm,
                apiKey: config.llm.apiKey ? '[REDACTED]' : undefined,
            },
            mcpServers: config.mcpServers
                ? Object.fromEntries(
                      Object.entries(config.mcpServers).map(([name, serverConfig]) => [
                          name,
                          serverConfig.type === 'stdio' && serverConfig.env
                              ? {
                                    ...serverConfig,
                                    env: Object.fromEntries(
                                        Object.keys(serverConfig.env).map((key) => [
                                            key,
                                            '[REDACTED]',
                                        ])
                                    ),
                                }
                              : serverConfig,
                      ])
                  )
                : undefined,
        };

        const yamlStr = yamlStringify(maskedConfig);
        ctx.header('Content-Type', 'application/x-yaml');
        return ctx.body(yamlStr);
    });

    return app;
}
