import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { AgentConfigSchema } from '@dexto/agent-config';
import { AgentError, logger, safeStringify, type LLMProvider, zodToIssues } from '@dexto/core';
import {
    getPrimaryApiKeyEnvVar,
    saveProviderApiKey,
    reloadAgentConfigFromFile,
    enrichAgentConfig,
    deriveDisplayName,
    AgentFactory,
} from '@dexto/agent-management';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { DextoValidationError, AgentErrorCode, ErrorScope, ErrorType } from '@dexto/core';
import {
    AgentRegistryEntrySchema,
    BadRequestErrorResponse,
    ConflictErrorResponse,
    InternalErrorResponse,
    JsonValueSchema,
    NotFoundErrorResponse,
} from '../schemas/responses.js';
import type { Context } from 'hono';
import type { GetAgentConfigPathFn, GetAgentFn, OpenAPIRouteSchema } from '../types.js';

/**
 * OpenAPI-safe version of AgentConfigSchema
 *
 * This simplified schema is used ONLY for OpenAPI documentation generation.
 * Runtime validation still uses the full AgentConfigSchema with complete validation.
 *
 * Why: The real AgentConfigSchema uses z.lazy() for CustomToolConfigSchema,
 * which cannot be serialized to OpenAPI JSON by @hono/zod-openapi.
 *
 * See lines 780 and 854 where AgentConfigSchema.safeParse() is used for actual validation.
 */
const AgentConfigSchemaForOpenAPI = z
    .record(z.string(), JsonValueSchema)
    .describe(
        'Complete agent configuration. See AgentConfig type documentation for full schema details.'
    );

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
    .strict()
    .describe('Agent identifier for switching agents by ID or file path');

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
    .strict()
    .describe('Request body for uninstalling an agent');

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
            .strict()
            .describe('Agent metadata including description, author, and tags'),
    })
    .strict()
    .describe('Request body for installing a custom agent from file system')
    .transform((value) => {
        const displayName = value.name?.trim() || deriveDisplayName(value.id);
        return {
            id: value.id,
            displayName,
            sourcePath: value.sourcePath,
            metadata: value.metadata,
        };
    });

const CustomAgentCreateSchema = z
    .object({
        // Registry metadata
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
        // Full agent configuration
        config: AgentConfigSchemaForOpenAPI.describe('Complete agent configuration'),
    })
    .strict()
    .describe('Request body for creating a new custom agent with full configuration');

const AgentConfigValidateSchema = z
    .object({
        yaml: z.string().describe('YAML agent configuration content to validate'),
    })
    .describe('Request body for validating agent configuration YAML');

const AgentConfigSaveSchema = z
    .object({
        yaml: z
            .string()
            .min(1, 'YAML content is required')
            .describe('YAML agent configuration content to save'),
    })
    .describe('Request body for saving agent configuration YAML');

// Response schemas for agent endpoints

const AgentInfoNullableSchema = z
    .object({
        id: z.string().nullable().describe('Agent identifier (null if no active agent)'),
        name: z.string().nullable().describe('Agent display name (null if no active agent)'),
    })
    .strict()
    .describe('Basic agent information (nullable)');

const ListAgentsResponseSchema = z
    .object({
        installed: z.array(AgentRegistryEntrySchema).describe('Agents installed locally'),
        available: z.array(AgentRegistryEntrySchema).describe('Agents available from registry'),
        current: AgentInfoNullableSchema.describe('Currently active agent'),
    })
    .strict()
    .describe('List of all agents');

const InstallAgentResponseSchema = z
    .object({
        installed: z.literal(true).describe('Indicates successful installation'),
        id: z.string().describe('Installed agent ID'),
        name: z.string().describe('Installed agent name'),
        type: z.enum(['builtin', 'custom']).describe('Type of agent installed'),
    })
    .strict()
    .describe('Agent installation response');

const SwitchAgentResponseSchema = z
    .object({
        switched: z.literal(true).describe('Indicates successful agent switch'),
        id: z.string().describe('New active agent ID'),
        name: z.string().describe('New active agent name'),
    })
    .strict()
    .describe('Agent switch response');

const ValidateNameResponseSchema = z
    .object({
        valid: z.boolean().describe('Whether the agent name is valid'),
        conflict: z.string().optional().describe('Type of conflict if name is invalid'),
        message: z.string().optional().describe('Validation message'),
    })
    .strict()
    .describe('Agent name validation result');

const UninstallAgentResponseSchema = z
    .object({
        uninstalled: z.literal(true).describe('Indicates successful uninstallation'),
        id: z.string().describe('Uninstalled agent ID'),
    })
    .strict()
    .describe('Agent uninstallation response');

const AgentPathResponseSchema = z
    .object({
        path: z.string().describe('Absolute path to agent configuration file'),
        relativePath: z.string().describe('Relative path or basename'),
        name: z.string().describe('Agent configuration filename without extension'),
        isDefault: z.boolean().describe('Whether this is the default agent'),
    })
    .strict()
    .describe('Agent file path information');

const AgentConfigResponseSchema = z
    .object({
        yaml: z.string().describe('Raw YAML configuration content'),
        path: z.string().describe('Absolute path to configuration file'),
        relativePath: z.string().describe('Relative path or basename'),
        lastModified: z.date().describe('Last modification timestamp'),
        warnings: z.array(z.string()).describe('Configuration warnings'),
    })
    .strict()
    .describe('Agent configuration content');

const SaveConfigResponseSchema = z
    .object({
        ok: z.literal(true).describe('Indicates successful save'),
        path: z.string().describe('Path to saved configuration file'),
        reloaded: z.boolean().describe('Whether configuration was reloaded'),
        restarted: z.boolean().describe('Whether agent was restarted'),
        changesApplied: z.array(z.string()).describe('List of changes that were applied'),
        message: z.string().describe('Success message'),
    })
    .strict()
    .describe('Configuration save result');

const CreateCustomAgentResponseSchema = z
    .object({
        created: z.literal(true).describe('Creation success indicator'),
        id: z.string().describe('Agent identifier'),
        name: z.string().describe('Agent name'),
    })
    .strict()
    .describe('Custom agent creation response');

const ValidateConfigErrorSchema = z
    .object({
        line: z.number().int().optional().describe('Line number'),
        column: z.number().int().optional().describe('Column number'),
        path: z.string().optional().describe('Configuration path'),
        message: z.string().describe('Error message'),
        code: z.string().describe('Error code'),
    })
    .passthrough()
    .describe('Configuration validation error');

const ValidateConfigWarningSchema = z
    .object({
        path: z.string().describe('Configuration path'),
        message: z.string().describe('Warning message'),
        code: z.string().describe('Warning code'),
    })
    .strict()
    .describe('Configuration validation warning');

const ValidateConfigResponseSchema = z
    .object({
        valid: z.boolean().describe('Whether configuration is valid'),
        errors: z.array(ValidateConfigErrorSchema).describe('Validation errors'),
        warnings: z.array(ValidateConfigWarningSchema).describe('Configuration warnings'),
    })
    .strict()
    .describe('Configuration validation result');

const ExportConfigQuerySchema = z
    .object({
        sessionId: z
            .string()
            .optional()
            .describe('Session identifier to export session-specific configuration'),
    })
    .describe('Export configuration query');

const InstallAgentRequestSchema = z
    .union([CustomAgentInstallSchema, AgentIdentifierSchema])
    .describe('Agent installation request');

const listRoute = createRoute({
    method: 'get',
    path: '/agents',
    summary: 'List Agents',
    description: 'Retrieves all agents (installed, available, and current active agent)',
    tags: ['agents'],
    responses: {
        200: {
            description: 'List all agents',
            content: { 'application/json': { schema: ListAgentsResponseSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const currentRoute = createRoute({
    method: 'get',
    path: '/agents/current',
    summary: 'Get Current Agent',
    description: 'Retrieves the currently active agent',
    tags: ['agents'],
    responses: {
        200: {
            description: 'Current agent',
            content: { 'application/json': { schema: AgentInfoNullableSchema } },
        },
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const installRoute = createRoute({
    method: 'post',
    path: '/agents/install',
    summary: 'Install Agent',
    description: 'Installs an agent from the registry or from a custom source',
    tags: ['agents'],
    request: {
        body: {
            content: {
                'application/json': {
                    schema: InstallAgentRequestSchema,
                },
            },
        },
    },
    responses: {
        201: {
            description: 'Agent installed',
            content: { 'application/json': { schema: InstallAgentResponseSchema } },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        409: ConflictErrorResponse,
        500: InternalErrorResponse,
    },
});

const switchRoute = createRoute({
    method: 'post',
    path: '/agents/switch',
    summary: 'Switch Agent',
    description: 'Switches to a different agent by ID or file path',
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
            content: { 'application/json': { schema: SwitchAgentResponseSchema } },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        409: ConflictErrorResponse,
        500: InternalErrorResponse,
    },
});

const validateNameRoute = createRoute({
    method: 'post',
    path: '/agents/validate-name',
    summary: 'Validate Agent Name',
    description: 'Checks if an agent ID conflicts with existing agents',
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
            content: { 'application/json': { schema: ValidateNameResponseSchema } },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        409: ConflictErrorResponse,
        500: InternalErrorResponse,
    },
});

const uninstallRoute = createRoute({
    method: 'post',
    path: '/agents/uninstall',
    summary: 'Uninstall Agent',
    description:
        'Removes an agent from the system. Custom agents are removed from registry; builtin agents can be reinstalled',
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
            content: { 'application/json': { schema: UninstallAgentResponseSchema } },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        409: ConflictErrorResponse,
        500: InternalErrorResponse,
    },
});

const customCreateRoute = createRoute({
    method: 'post',
    path: '/agents/custom/create',
    summary: 'Create Custom Agent',
    description: 'Creates a new custom agent from scratch via the UI/API',
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
            content: {
                'application/json': {
                    schema: CreateCustomAgentResponseSchema,
                },
            },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        409: ConflictErrorResponse,
        500: InternalErrorResponse,
    },
});

const getPathRoute = createRoute({
    method: 'get',
    path: '/agent/path',
    summary: 'Get Agent File Path',
    description: 'Retrieves the file path of the currently active agent configuration',
    tags: ['agent'],
    responses: {
        200: {
            description: 'Agent file path',
            content: {
                'application/json': {
                    schema: AgentPathResponseSchema,
                },
            },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        409: ConflictErrorResponse,
        500: InternalErrorResponse,
    },
});

const getConfigRoute = createRoute({
    method: 'get',
    path: '/agent/config',
    summary: 'Get Agent Configuration',
    description: 'Retrieves the raw YAML configuration of the currently active agent',
    tags: ['agent'],
    responses: {
        200: {
            description: 'Agent configuration',
            content: {
                'application/json': {
                    schema: AgentConfigResponseSchema,
                },
            },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        409: ConflictErrorResponse,
        500: InternalErrorResponse,
    },
});

const validateConfigRoute = createRoute({
    method: 'post',
    path: '/agent/validate',
    summary: 'Validate Agent Configuration',
    description: 'Validates YAML agent configuration without saving it',
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
            content: {
                'application/json': {
                    schema: ValidateConfigResponseSchema,
                },
            },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        409: ConflictErrorResponse,
        500: InternalErrorResponse,
    },
});

const saveConfigRoute = createRoute({
    method: 'post',
    path: '/agent/config',
    summary: 'Save Agent Configuration',
    description: 'Saves and applies YAML agent configuration. Creates backup before saving',
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
            content: {
                'application/json': {
                    schema: SaveConfigResponseSchema,
                },
            },
        },
        400: BadRequestErrorResponse,
        404: NotFoundErrorResponse,
        409: ConflictErrorResponse,
        500: InternalErrorResponse,
    },
});

const exportConfigRoute = createRoute({
    method: 'get',
    path: '/agent/config/export',
    summary: 'Export Agent Configuration',
    description: 'Exports the effective agent configuration with sensitive values redacted',
    tags: ['agent'],
    request: {
        query: ExportConfigQuerySchema,
    },
    responses: {
        200: {
            description: 'Exported configuration',
            content: { 'application/x-yaml': { schema: z.string() } },
        },
    },
});

export type AgentsRouterContext = {
    switchAgentById: (agentId: string) => Promise<{ id: string; name: string }>;
    switchAgentByPath: (filePath: string) => Promise<{ id: string; name: string }>;
    resolveAgentInfo: (agentId: string) => Promise<{ id: string; name: string }>;
    ensureAgentAvailable: () => void;
    getActiveAgentId: () => string | undefined;
};

export function createAgentsRouter(
    getAgent: GetAgentFn,
    context: AgentsRouterContext,
    getAgentConfigPath: GetAgentConfigPathFn
) {
    const app = new OpenAPIHono();
    const { switchAgentById, switchAgentByPath, resolveAgentInfo, getActiveAgentId } = context;
    const resolveAgentConfigPath = async (ctx: Context): Promise<string> => {
        const configPath = await getAgentConfigPath(ctx);
        if (!configPath) {
            throw AgentError.noConfigPath();
        }
        return configPath;
    };

    return app
        .openapi(listRoute, async (ctx) => {
            const agents = await AgentFactory.listAgents();
            const currentId = getActiveAgentId() ?? null;
            return ctx.json(
                {
                    installed: agents.installed,
                    available: agents.available,
                    current: currentId
                        ? await resolveAgentInfo(currentId)
                        : { id: null, name: null },
                },
                200
            );
        })
        .openapi(currentRoute, async (ctx) => {
            const currentId = getActiveAgentId() ?? null;
            if (!currentId) {
                return ctx.json({ id: null, name: null }, 200);
            }
            return ctx.json(await resolveAgentInfo(currentId), 200);
        })
        .openapi(installRoute, async (ctx) => {
            const body = ctx.req.valid('json');

            // Check if this is a custom agent installation (has sourcePath and metadata)
            if ('sourcePath' in body && 'metadata' in body) {
                const { id, displayName, sourcePath, metadata } = body as ReturnType<
                    typeof CustomAgentInstallSchema.parse
                >;

                await AgentFactory.installCustomAgent(id, sourcePath, {
                    name: displayName,
                    description: metadata.description,
                    author: metadata.author,
                    tags: metadata.tags,
                });
                return ctx.json(
                    { installed: true as const, id, name: displayName, type: 'custom' as const },
                    201
                );
            } else {
                // Registry agent installation
                const { id } = body as z.output<typeof AgentIdentifierSchema>;
                await AgentFactory.installAgent(id);
                const agentInfo = await resolveAgentInfo(id);
                return ctx.json(
                    {
                        installed: true as const,
                        ...agentInfo,
                        type: 'builtin' as const,
                    },
                    201
                );
            }
        })
        .openapi(switchRoute, async (ctx) => {
            const { id, path: filePath } = ctx.req.valid('json');

            // Route based on presence of path parameter
            const result = filePath ? await switchAgentByPath(filePath) : await switchAgentById(id);

            return ctx.json({ switched: true as const, ...result }, 200);
        })
        .openapi(validateNameRoute, async (ctx) => {
            const { id } = ctx.req.valid('json');
            const agents = await AgentFactory.listAgents();

            // Check if name exists in installed agents
            const installedAgent = agents.installed.find((a) => a.id === id);
            if (installedAgent) {
                return ctx.json(
                    {
                        valid: false,
                        conflict: installedAgent.type,
                        message: `Agent id '${id}' already exists (${installedAgent.type})`,
                    },
                    200
                );
            }

            // Check if name exists in available agents (registry)
            const availableAgent = agents.available.find((a) => a.id === id);
            if (availableAgent) {
                return ctx.json(
                    {
                        valid: false,
                        conflict: availableAgent.type,
                        message: `Agent id '${id}' conflicts with ${availableAgent.type} agent`,
                    },
                    200
                );
            }

            return ctx.json({ valid: true }, 200);
        })
        .openapi(uninstallRoute, async (ctx) => {
            const { id, force } = ctx.req.valid('json');
            await AgentFactory.uninstallAgent(id, force);
            return ctx.json({ uninstalled: true as const, id }, 200);
        })
        .openapi(customCreateRoute, async (ctx) => {
            const { id, name, description, author, tags, config } = ctx.req.valid('json');
            const configResult = AgentConfigSchema.safeParse(config);

            if (!configResult.success) {
                throw new DextoValidationError(zodToIssues(configResult.error));
            }

            const validatedConfig = configResult.data;

            // Handle API key: if it's a raw key, store securely and use env var reference
            const provider: LLMProvider = validatedConfig.llm.provider;
            let agentConfig = validatedConfig;

            if (validatedConfig.llm.apiKey && !validatedConfig.llm.apiKey.startsWith('$')) {
                // Raw API key provided - store securely and get env var reference
                const meta = await saveProviderApiKey(
                    provider,
                    validatedConfig.llm.apiKey,
                    process.cwd()
                );
                const apiKeyRef = `$${meta.envVar}`;
                logger.info(
                    `Stored API key securely for ${provider}, using env var: ${meta.envVar}`
                );
                // Update config with env var reference
                agentConfig = {
                    ...validatedConfig,
                    llm: {
                        ...validatedConfig.llm,
                        apiKey: apiKeyRef,
                    },
                };
            } else if (!validatedConfig.llm.apiKey) {
                // No API key provided, use default env var
                agentConfig = {
                    ...validatedConfig,
                    llm: {
                        ...validatedConfig.llm,
                        apiKey: `$${getPrimaryApiKeyEnvVar(provider)}`,
                    },
                };
            }

            const yamlContent = yamlStringify(agentConfig);
            logger.info(
                `Creating agent config for ${id}: agentConfig=${safeStringify(agentConfig)}, yamlContent=${yamlContent}`
            );

            // Create temporary file
            const tmpDir = os.tmpdir();
            const tmpFile = path.join(tmpDir, `${id}-${Date.now()}.yml`);
            await fs.writeFile(tmpFile, yamlContent, 'utf-8');

            try {
                // Install the custom agent
                await AgentFactory.installCustomAgent(id, tmpFile, {
                    name,
                    description,
                    author: author || 'Custom',
                    tags: tags || [],
                });

                // Clean up temp file
                await fs.unlink(tmpFile).catch(() => {});

                return ctx.json({ created: true as const, id, name }, 201);
            } catch (installError) {
                // Clean up temp file on error
                await fs.unlink(tmpFile).catch(() => {});
                throw installError;
            }
        })
        .openapi(getPathRoute, async (ctx) => {
            const agentPath = await resolveAgentConfigPath(ctx);

            const relativePath = path.basename(agentPath);
            const ext = path.extname(agentPath);
            const name = path.basename(agentPath, ext);

            return ctx.json(
                {
                    path: agentPath,
                    relativePath,
                    name,
                    isDefault: name === 'coding-agent',
                },
                200
            );
        })
        .openapi(getConfigRoute, async (ctx) => {
            // Get the agent file path being used
            const agentPath = await resolveAgentConfigPath(ctx);

            // Read raw YAML from file (not expanded env vars)
            const yamlContent = await fs.readFile(agentPath, 'utf-8');

            // Get metadata
            const stats = await fs.stat(agentPath);

            return ctx.json(
                {
                    yaml: yamlContent,
                    path: agentPath,
                    relativePath: path.basename(agentPath),
                    lastModified: stats.mtime,
                    warnings: [
                        'Environment variables ($VAR) will be resolved at runtime',
                        'API keys should use environment variables',
                    ],
                },
                200
            );
        })
        .openapi(validateConfigRoute, async (ctx) => {
            const { yaml } = ctx.req.valid('json');

            // Parse YAML
            let parsed;
            try {
                parsed = yamlParse(yaml);
            } catch (parseError: unknown) {
                const message =
                    parseError instanceof Error ? parseError.message : String(parseError);
                const linePos =
                    typeof parseError === 'object' && parseError !== null && 'linePos' in parseError
                        ? (parseError as { linePos?: Array<{ line?: number; col?: number }> })
                              .linePos
                        : undefined;

                return ctx.json(
                    {
                        valid: false,
                        errors: [
                            {
                                line: linePos?.[0]?.line ?? 1,
                                column: linePos?.[0]?.col ?? 1,
                                message,
                                code: 'YAML_PARSE_ERROR',
                            },
                        ],
                        warnings: [],
                    },
                    200
                );
            }

            // Check that parsed content is a valid object (not null, array, or primitive)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return ctx.json(
                    {
                        valid: false,
                        errors: [
                            {
                                line: 1,
                                column: 1,
                                message: 'Configuration must be a valid YAML object',
                                code: 'INVALID_CONFIG_TYPE',
                            },
                        ],
                        warnings: [],
                    },
                    200
                );
            }

            // Enrich config with defaults/paths to satisfy schema requirements
            // Pass undefined for validation-only (no real file path)
            // AgentId will be derived from agentCard.name or fall back to 'coding-agent'
            const enriched = enrichAgentConfig(parsed, undefined);

            // Validate against schema
            const result = AgentConfigSchema.safeParse(enriched);

            if (!result.success) {
                // Use zodToIssues to extract detailed validation errors (handles union errors properly)
                const issues = zodToIssues(result.error);
                const errors = issues.map((issue) => ({
                    path: issue.path?.join('.') ?? 'root',
                    message: issue.message,
                    code: 'SCHEMA_VALIDATION_ERROR',
                }));

                return ctx.json(
                    {
                        valid: false,
                        errors,
                        warnings: [],
                    },
                    200
                );
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

            return ctx.json(
                {
                    valid: true,
                    errors: [],
                    warnings,
                },
                200
            );
        })
        .openapi(saveConfigRoute, async (ctx) => {
            const { yaml } = ctx.req.valid('json');

            // Validate YAML syntax first
            let parsed;
            try {
                parsed = yamlParse(yaml);
            } catch (parseError: unknown) {
                const message =
                    parseError instanceof Error ? parseError.message : String(parseError);
                throw new DextoValidationError([
                    {
                        code: AgentErrorCode.INVALID_CONFIG,
                        message: `Invalid YAML syntax: ${message}`,
                        scope: ErrorScope.AGENT,
                        type: ErrorType.USER,
                        severity: 'error',
                    },
                ]);
            }

            // Check that parsed content is a valid object (not null, array, or primitive)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new DextoValidationError([
                    {
                        code: AgentErrorCode.INVALID_CONFIG,
                        message: 'Configuration must be a valid YAML object',
                        scope: ErrorScope.AGENT,
                        type: ErrorType.USER,
                        severity: 'error',
                    },
                ]);
            }

            // Get target file path for enrichment
            const agentPath = await resolveAgentConfigPath(ctx);

            // Enrich config with defaults/paths before validation (same as validation endpoint)
            const enriched = enrichAgentConfig(parsed, agentPath);

            // Validate schema
            const validationResult = AgentConfigSchema.safeParse(enriched);

            if (!validationResult.success) {
                throw new DextoValidationError(
                    zodToIssues(validationResult.error).map((err) => ({
                        code: AgentErrorCode.INVALID_CONFIG,
                        message: `${err.path?.join('.') || 'root'}: ${err.message}`,
                        scope: ErrorScope.AGENT,
                        type: ErrorType.USER,
                        severity: 'error',
                    }))
                );
            }

            // Create backup
            const backupPath = `${agentPath}.backup`;
            await fs.copyFile(agentPath, backupPath);

            try {
                // Write new config
                await fs.writeFile(agentPath, yaml, 'utf-8');

                // Re-create the agent from the updated file and switch to it.
                // Core has no file path concerns or reload semantics.
                await switchAgentByPath(agentPath);

                // Clean up backup file after successful save
                await fs.unlink(backupPath).catch(() => {
                    // Ignore errors if backup file doesn't exist
                });

                logger.info(`Agent configuration saved and applied: ${agentPath}`);

                return ctx.json(
                    {
                        ok: true as const,
                        path: agentPath,
                        reloaded: true,
                        restarted: true,
                        changesApplied: ['restart'],
                        message: 'Configuration saved and applied successfully (agent restarted)',
                    },
                    200
                );
            } catch (error) {
                // Restore backup on error
                await fs.copyFile(backupPath, agentPath).catch(() => {
                    // Ignore errors if backup restore fails
                });
                throw error;
            }
        })
        .openapi(exportConfigRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('query');
            const agentPath = await resolveAgentConfigPath(ctx);

            // Start from file config (host concern) and overlay runtime-effective settings.
            // This keeps DI surface fields (tools/storage/logger/hooks/image/agentFile) from the file,
            // while reflecting session-specific changes like LLM model switches.
            const fileConfig = await reloadAgentConfigFromFile(agentPath);
            const enrichedConfig = enrichAgentConfig(fileConfig, agentPath);
            const validatedConfig = AgentConfigSchema.parse(enrichedConfig);
            const effectiveSettings = agent.getEffectiveConfig(sessionId);

            const config = {
                ...validatedConfig,
                ...effectiveSettings,
                llm: {
                    ...validatedConfig.llm,
                    ...effectiveSettings.llm,
                },
            };

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
}

type AgentIdentifierJsonInput = { json: z.input<typeof AgentIdentifierSchema> };
type UninstallAgentJsonInput = { json: z.input<typeof UninstallAgentSchema> };
type CustomAgentCreateJsonInput = { json: z.input<typeof CustomAgentCreateSchema> };
type InstallAgentJsonInput = { json: z.input<typeof InstallAgentRequestSchema> };
type AgentConfigValidateJsonInput = { json: z.input<typeof AgentConfigValidateSchema> };
type AgentConfigSaveJsonInput = { json: z.input<typeof AgentConfigSaveSchema> };
type ExportConfigQueryInput = { query: z.input<typeof ExportConfigQuerySchema> };

type ListRouteSchema = OpenAPIRouteSchema<typeof listRoute, {}>;
type CurrentRouteSchema = OpenAPIRouteSchema<typeof currentRoute, {}>;
type InstallRouteSchema = OpenAPIRouteSchema<typeof installRoute, InstallAgentJsonInput>;
type SwitchRouteSchema = OpenAPIRouteSchema<typeof switchRoute, AgentIdentifierJsonInput>;
type ValidateNameRouteSchema = OpenAPIRouteSchema<
    typeof validateNameRoute,
    AgentIdentifierJsonInput
>;
type UninstallRouteSchema = OpenAPIRouteSchema<typeof uninstallRoute, UninstallAgentJsonInput>;
type CustomCreateRouteSchema = OpenAPIRouteSchema<
    typeof customCreateRoute,
    CustomAgentCreateJsonInput
>;
type GetPathRouteSchema = OpenAPIRouteSchema<typeof getPathRoute, {}>;
type GetConfigRouteSchema = OpenAPIRouteSchema<typeof getConfigRoute, {}>;
type ValidateConfigRouteSchema = OpenAPIRouteSchema<
    typeof validateConfigRoute,
    AgentConfigValidateJsonInput
>;
type SaveConfigRouteSchema = OpenAPIRouteSchema<typeof saveConfigRoute, AgentConfigSaveJsonInput>;
type ExportConfigRouteSchema = OpenAPIRouteSchema<typeof exportConfigRoute, ExportConfigQueryInput>;

export type AgentsRouterSchema =
    | ListRouteSchema
    | CurrentRouteSchema
    | InstallRouteSchema
    | SwitchRouteSchema
    | ValidateNameRouteSchema
    | UninstallRouteSchema
    | CustomCreateRouteSchema
    | GetPathRouteSchema
    | GetConfigRouteSchema
    | ValidateConfigRouteSchema
    | SaveConfigRouteSchema
    | ExportConfigRouteSchema;
