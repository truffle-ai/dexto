import express from 'express';
import type { Express, Response } from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { WebSocketEventSubscriber } from './websocket-subscriber.js';
import { WebhookEventSubscriber } from './webhook-subscriber.js';
import type { WebhookConfig } from './webhook-types.js';
import { logger, redactSensitiveData, type AgentCard } from '@dexto/core';
import { setupA2ARoutes } from './a2a.js';
import { setupMemoryRoutes } from './memory/memory-handler.js';
import {
    createMcpTransport,
    initializeMcpServer,
    initializeMcpServerApiEndpoints,
    type McpTransportType,
} from './mcp/mcp_handler.js';
import { createAgentCard, DextoAgent, loadAgentConfig } from '@dexto/core';
import { Dexto, deriveDisplayName } from '@dexto/agent-management';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import os from 'os';
import { promises as fs } from 'fs';
import path from 'path';
import { expressRedactionMiddleware } from './middleware/expressRedactionMiddleware.js';
import { z } from 'zod';
import { LLMUpdatesSchema } from '@dexto/core';
import { registerGracefulShutdown } from '../utils/graceful-shutdown.js';
import { validateInputForLLM } from '@dexto/core';
import {
    LLM_REGISTRY,
    LLM_PROVIDERS,
    LLM_ROUTERS,
    SUPPORTED_FILE_TYPES,
    getSupportedRoutersForProvider,
    supportsBaseURL,
    isRouterSupportedForModel,
} from '@dexto/core';
import type { ProviderInfo, LLMProvider } from '@dexto/core';
import { getProviderKeyStatus, saveProviderApiKey, getPrimaryApiKeyEnvVar } from '@dexto/core';
import { errorHandler } from './middleware/errorHandler.js';
import { McpServerConfigSchema, type McpServerConfig } from '@dexto/core';
import { sendWebSocketError, sendWebSocketValidationError } from './websocket-error-handler.js';
import {
    DextoValidationError,
    ErrorScope,
    ErrorType,
    AgentErrorCode,
    AgentError,
    AgentConfigSchema,
    ApprovalResponseSchema,
} from '@dexto/core';
import { ResourceError } from '@dexto/core';
import { PromptError } from '@dexto/core';

/**
 * Helper function to send JSON response with optional pretty printing
 */
function sendJsonResponse<T>(res: Response, data: T, statusCode = 200) {
    const pretty = res.req.query.pretty === 'true' || res.req.query.pretty === '1';
    res.status(statusCode);

    if (pretty) {
        res.set('Content-Type', 'application/json');
        res.send(JSON.stringify(data, null, 2));
    } else {
        res.json(data);
    }
}

// Helper to parse and validate request body
function parseBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
    return schema.parse(body); // ZodError handled by error middleware
}

// Helper to parse and validate query parameters
function parseQuery<T>(schema: z.ZodSchema<T>, query: unknown): T {
    return schema.parse(query); // ZodError handled by error middleware
}

// TODO: API endpoint names are work in progress and might be refactored/renamed in future versions
export async function initializeApi(
    agent: DextoAgent,
    agentCardOverride?: Partial<AgentCard>,
    listenPort?: number,
    agentId?: string
): Promise<{
    app: Express;
    server: http.Server;
    wss: WebSocketServer;
    webSubscriber: WebSocketEventSubscriber;
    webhookSubscriber: WebhookEventSubscriber;
}> {
    const app = express();
    // Declare before registering shutdown hook to avoid TDZ on signals
    let activeAgent: DextoAgent = agent;
    let activeAgentId: string | undefined = agentId || 'default-agent';
    let isSwitchingAgent = false;
    registerGracefulShutdown(() => activeAgent);

    // CORS middleware to allow frontend to connect from different ports
    app.use((req, res, next) => {
        const origin = req.headers.origin;

        // Define allowed origins based on environment
        const allowedOrigins: string[] = [];

        // 1. Always allow localhost/127.0.0.1 on any port (for local development)
        if (origin) {
            const originUrl = new URL(origin);
            const hostname = originUrl.hostname;
            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
                allowedOrigins.push(origin);
            }
        }

        // 2. Allow custom origins from environment variable (for production/network deployments)
        const customOrigins = process.env.DEXTO_ALLOWED_ORIGINS;
        if (customOrigins) {
            allowedOrigins.push(...customOrigins.split(',').map((o) => o.trim()));
        }

        // 3. Set CORS headers
        if (origin && allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        } else if (allowedOrigins.length === 0 && !origin) {
            // If no origin header (e.g., server-to-server), allow it
            res.setHeader('Access-Control-Allow-Origin', '*');
        }
        // If origin is not allowed, don't set CORS headers (browser will block)

        res.setHeader(
            'Access-Control-Allow-Methods',
            'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD'
        );
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        // Handle preflight requests
        if (req.method === 'OPTIONS') {
            return res.status(204).end();
        }

        return next();
    });

    // this will apply middleware to all /api/llm/* routes
    app.use('/api/llm', expressRedactionMiddleware);
    app.use('/api/config.yaml', expressRedactionMiddleware);

    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    logger.info(`Initializing API server with agent: ${activeAgentId}`);

    // Initialize event subscribers
    const webSubscriber = new WebSocketEventSubscriber(wss);
    const webhookSubscriber = new WebhookEventSubscriber();

    // Register subscribers before starting agent
    logger.info('Registering event subscribers with agent...');
    activeAgent.registerSubscriber(webSubscriber);
    activeAgent.registerSubscriber(webhookSubscriber);

    // Ensure the initial agent is started
    if (!activeAgent.isStarted() && !activeAgent.isStopped()) {
        logger.info('Starting initial agent...');
        await activeAgent.start();
    } else if (activeAgent.isStopped()) {
        logger.warn('Initial agent is stopped, this may cause issues');
    }

    // Tool confirmation responses are handled by the main WebSocket handler below

    function ensureAgentAvailable(): void {
        // Gate requests during agent switching
        if (isSwitchingAgent) {
            throw AgentError.switchInProgress();
        }

        // Fast path: most common case is agent is started and running
        if (activeAgent.isStarted() && !activeAgent.isStopped()) {
            return;
        }

        // Provide specific error messages for better debugging
        if (activeAgent.isStopped()) {
            throw AgentError.stopped();
        }
        if (!activeAgent.isStarted()) {
            throw AgentError.notStarted();
        }
    }

    /**
     * Common agent switching logic shared by switchAgentById and switchAgentByPath.
     * Handles: registering subscribers, starting agent, stopping previous agent, updating global state.
     *
     * @param newAgent The new DextoAgent instance to switch to
     * @param agentId The identifier for the agent (used for logging and state tracking)
     * @returns Agent info for the newly activated agent
     */
    async function performAgentSwitch(newAgent: DextoAgent, agentId: string) {
        // Register event subscribers with new agent before starting
        logger.info('Registering event subscribers with new agent...');
        newAgent.registerSubscriber(webSubscriber);
        newAgent.registerSubscriber(webhookSubscriber);

        logger.info(`Starting new agent: ${agentId}`);
        await newAgent.start();

        // Stop previous agent last (only after new one is fully operational)
        const previousAgent = activeAgent;
        activeAgent = newAgent;
        activeAgentId = agentId;

        // Update agent card for A2A and MCP routes
        agentCardData = createAgentCard(
            {
                defaultName: agentId,
                defaultVersion: overrides.version ?? '1.0.0',
                defaultBaseUrl: baseApiUrl,
                webSubscriber,
            },
            overrides
        );

        logger.info(`Successfully switched to agent: ${agentId}`);

        // Now safely stop the previous agent
        try {
            if (previousAgent && previousAgent !== newAgent) {
                logger.info('Stopping previous agent...');
                await previousAgent.stop();
            }
        } catch (err) {
            logger.warn(`Stopping previous agent failed: ${err}`);
            // Don't throw here as the switch was successful
        }

        return await resolveAgentInfo(agentId);
    }

    async function switchAgentById(agentId: string) {
        if (isSwitchingAgent) {
            throw AgentError.switchInProgress();
        }
        isSwitchingAgent = true;

        let newAgent: DextoAgent | undefined;
        try {
            // 1. SHUTDOWN OLD TELEMETRY FIRST (before creating new agent)
            // This allows new agent to have different telemetry config (endpoint, protocol, etc.)
            logger.info('Shutting down telemetry for agent switch...');
            const { Telemetry } = await import('@dexto/core');
            await Telemetry.shutdownGlobal();

            // 2. Create new agent from registry (will initialize fresh telemetry in createAgentServices)
            newAgent = await Dexto.createAgent(agentId);

            // 3. Use common switch logic (register subscribers, start agent, stop previous)
            return await performAgentSwitch(newAgent, agentId);
        } catch (error) {
            logger.error(
                `Failed to switch to agent '${agentId}': ${
                    error instanceof Error ? error.message : String(error)
                }`,
                { error }
            );

            // Clean up the failed new agent if it was created
            if (newAgent) {
                try {
                    await newAgent.stop();
                } catch (cleanupErr) {
                    logger.warn(`Failed to cleanup new agent: ${cleanupErr}`);
                }
            }

            throw error;
        } finally {
            isSwitchingAgent = false;
        }
    }

    async function switchAgentByPath(filePath: string) {
        if (isSwitchingAgent) {
            throw AgentError.switchInProgress();
        }
        isSwitchingAgent = true;

        let newAgent: DextoAgent | undefined;
        try {
            // 1. SHUTDOWN OLD TELEMETRY FIRST (before creating new agent)
            // This allows new agent to have different telemetry config (endpoint, protocol, etc.)
            logger.info('Shutting down telemetry for agent switch...');
            const { Telemetry } = await import('@dexto/core');
            await Telemetry.shutdownGlobal();

            // 2. Load agent configuration from file path
            const config = await loadAgentConfig(filePath);

            // 3. Create new agent instance directly (will initialize fresh telemetry in createAgentServices)
            newAgent = new DextoAgent(config, filePath);

            // 4. Derive agent ID from config or filename
            const agentId =
                config.agentCard?.name || path.basename(filePath, path.extname(filePath));

            // 5. Use common switch logic (register subscribers, start agent, stop previous)
            return await performAgentSwitch(newAgent, agentId);
        } catch (error) {
            logger.error(
                `Failed to switch to agent from path '${filePath}': ${
                    error instanceof Error ? error.message : String(error)
                }`,
                { error }
            );

            // Clean up the failed new agent if it was created
            if (newAgent) {
                try {
                    await newAgent.stop();
                } catch (cleanupErr) {
                    logger.warn(`Failed to cleanup new agent: ${cleanupErr}`);
                }
            }

            throw error;
        } finally {
            isSwitchingAgent = false;
        }
    }

    // HTTP endpoints

    // ---- Helpers (local) ----

    /**
     * Helper to decode URI components with consistent error handling.
     *
     * Wraps native decodeURIComponent() to provide domain-specific error handling.
     * While normally 1-line wrappers are discouraged, this is justified because:
     * 1. Native TS function with no control over error type
     * 2. Ensures consistent ResourceError across all URI decoding
     * 3. Reused in 5+ Zod transform schemas
     */
    function decodeUriComponent(encoded: string): string {
        try {
            return decodeURIComponent(encoded);
        } catch (_error) {
            throw ResourceError.invalidUriFormat(encoded, 'valid URI-encoded resource identifier');
        }
    }

    /**
     * Helper function to redact sensitive environment variables
     */
    function redactEnvValue(value: unknown): string {
        if (value && typeof value === 'string' && value.length > 0) {
            return '[REDACTED]';
        }
        return String(value ?? '');
    }

    /**
     * Helper function to redact environment variables in a server config
     */
    function redactServerEnvVars(serverConfig: McpServerConfig): McpServerConfig {
        if (serverConfig.type !== 'stdio' || !serverConfig.env) {
            return serverConfig;
        }

        const redactedEnv: Record<string, string> = {};
        for (const [key, value] of Object.entries(serverConfig.env)) {
            redactedEnv[key] = redactEnvValue(value);
        }

        return {
            ...serverConfig,
            env: redactedEnv,
        };
    }

    /**
     * Helper function to redact all MCP servers configuration
     */
    function redactMcpServersConfig(
        mcpServers: Record<string, McpServerConfig> | undefined
    ): Record<string, McpServerConfig> {
        if (!mcpServers) {
            return {};
        }

        const redactedServers: Record<string, McpServerConfig> = {};
        for (const [name, serverConfig] of Object.entries(mcpServers)) {
            redactedServers[name] = redactServerEnvVars(serverConfig);
        }

        return redactedServers;
    }

    // Health check endpoint
    app.get('/health', (_req, res) => {
        res.status(200).send('OK');
    });

    // Prompts listing endpoint (for WebUI slash command autocomplete)
    app.get('/api/prompts', async (_req, res, next) => {
        try {
            ensureAgentAvailable();
            const prompts = await activeAgent.listPrompts();
            const list = Object.values(prompts);
            return res.status(200).json({ prompts: list });
        } catch (error) {
            return next(error);
        }
    });

    const CustomPromptRequestSchema = z
        .object({
            name: z.string().min(1, 'Prompt name is required'),
            title: z.string().optional(),
            description: z.string().optional(),
            content: z.string().min(1, 'Prompt content is required'),
            arguments: z
                .array(
                    z
                        .object({
                            name: z.string().min(1, 'Argument name is required'),
                            description: z.string().optional(),
                            required: z.boolean().optional(),
                        })
                        .strict()
                )
                .optional(),
            resource: z
                .object({
                    base64: z.string().min(1, 'Resource data is required'),
                    mimeType: z.string().min(1, 'Resource MIME type is required'),
                    filename: z.string().optional(),
                })
                .strict()
                .optional(),
        })
        .strict();
    app.post('/api/prompts/custom', express.json({ limit: '10mb' }), async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const payload = parseBody(CustomPromptRequestSchema, req.body);
            const promptArguments = payload.arguments
                ?.map((arg) => ({
                    name: arg.name,
                    ...(arg.description ? { description: arg.description } : {}),
                    ...(typeof arg.required === 'boolean' ? { required: arg.required } : {}),
                }))
                .filter(Boolean);

            const createPayload = {
                name: payload.name,
                content: payload.content,
                ...(payload.title ? { title: payload.title } : {}),
                ...(payload.description ? { description: payload.description } : {}),
                ...(promptArguments && promptArguments.length > 0
                    ? { arguments: promptArguments }
                    : {}),
                ...(payload.resource
                    ? {
                          resource: {
                              base64: payload.resource.base64,
                              mimeType: payload.resource.mimeType,
                              ...(payload.resource.filename
                                  ? { filename: payload.resource.filename }
                                  : {}),
                          },
                      }
                    : {}),
            };
            const prompt = await activeAgent.createCustomPrompt(createPayload);
            return res.status(201).json({ prompt });
        } catch (error) {
            return next(error);
        }
    });

    const DeleteCustomPromptParamsSchema = z.object({
        name: z
            .string()
            .min(1, 'Prompt name is required')
            .transform((encoded) => decodeUriComponent(encoded)),
    });
    app.delete('/api/prompts/custom/:name', async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { name } = parseQuery(DeleteCustomPromptParamsSchema, req.params);
            await activeAgent.deleteCustomPrompt(name);
            return res.status(204).send();
        } catch (error) {
            return next(error);
        }
    });

    // Get a specific prompt definition
    const GetPromptDefinitionParamsSchema = z.object({
        name: z.string().min(1, 'Prompt name is required'),
    });
    app.get('/api/prompts/:name', async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { name } = parseQuery(GetPromptDefinitionParamsSchema, req.params);
            const definition = await activeAgent.getPromptDefinition(name);
            if (!definition) throw PromptError.notFound(name);
            return sendJsonResponse(res, { definition }, 200);
        } catch (error) {
            return next(error);
        }
    });

    // Resolve a prompt to text content (without sending to the agent)
    // Supports optional args via query string. For natural language after the
    // slash command, pass as `context`.
    const ResolvePromptParamsSchema = z.object({
        name: z.string().min(1, 'Prompt name is required'),
    });
    const ResolvePromptQuerySchema = z.object({
        context: z.string().optional(),
        args: z.string().optional(),
    });
    app.get('/api/prompts/:name/resolve', async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { name: inputName } = parseQuery(ResolvePromptParamsSchema, req.params);
            const { context, args: argsString } = parseQuery(ResolvePromptQuerySchema, req.query);

            // Optional structured args in `args` query param as JSON
            let parsedArgs: Record<string, unknown> | undefined;
            if (argsString) {
                try {
                    const parsed = JSON.parse(argsString);
                    if (parsed && typeof parsed === 'object') {
                        parsedArgs = parsed as Record<string, unknown>;
                    }
                } catch {
                    // Ignore malformed args JSON; continue with whatever we have
                }
            }

            // Build options object with only defined values (exactOptionalPropertyTypes compatibility)
            const options: {
                context?: string;
                args?: Record<string, unknown>;
            } = {};
            if (context !== undefined) options.context = context;
            if (parsedArgs !== undefined) options.args = parsedArgs;

            // Use DextoAgent's resolvePrompt method
            const result = await activeAgent.resolvePrompt(inputName, options);

            return sendJsonResponse(res, { text: result.text, resources: result.resources }, 200);
        } catch (error) {
            return next(error);
        }
    });

    // Note: We intentionally omit an "execute" endpoint; clients resolve prompts
    // and then call the regular message endpoint, keeping server surface minimal.

    // Message request schema (shared by /api/message and /api/message-sync)
    const MessageRequestSchema = z
        .object({
            message: z.string().optional(),
            sessionId: z.string().optional(),
            stream: z.boolean().optional(),
            imageData: z
                .object({
                    base64: z.string(),
                    mimeType: z.string(),
                })
                .optional(),
            fileData: z
                .object({
                    base64: z.string(),
                    mimeType: z.string(),
                    filename: z.string().optional(),
                })
                .optional(),
        })
        .refine(
            (data) => {
                const msg = (data.message ?? '').trim();
                // Must have either message text, image data, or file data
                return msg.length > 0 || !!data.imageData || !!data.fileData;
            },
            { message: 'Must provide either message text, image data, or file data' }
        );

    // JSON body size limit for message endpoints supporting base64 image/file payloads
    // Both /api/message and /api/message-sync accept base64 attachments; increased limit to avoid 413s.
    app.post(
        '/api/message',
        express.json({ limit: process.env.MESSAGE_JSON_LIMIT || '10mb' }),
        async (req, res, next) => {
            logger.info('Received message via POST /api/message');
            try {
                ensureAgentAvailable();
                const { message, sessionId, stream, imageData, fileData } = parseBody(
                    MessageRequestSchema,
                    req.body
                );

                const imageDataInput = imageData
                    ? { image: imageData.base64, mimeType: imageData.mimeType }
                    : undefined;

                // Process file data
                const fileDataInput = fileData
                    ? {
                          data: fileData.base64,
                          mimeType: fileData.mimeType,
                          ...(fileData.filename && { filename: fileData.filename }),
                      }
                    : undefined;

                if (imageDataInput) logger.info('Image data included in message.');
                if (fileDataInput) logger.info('File data included in message.');
                if (sessionId) logger.info(`Message for session: ${sessionId}`);

                const response = await activeAgent.run(
                    message || '',
                    imageDataInput,
                    fileDataInput,
                    sessionId,
                    stream || false
                );
                return res.status(202).send({ response, sessionId });
            } catch (error) {
                return next(error);
            }
        }
    );

    // Cancel an in-flight run for a session
    const CancelRequestSchema = z.object({
        sessionId: z.string().min(1, 'Session ID is required'),
    });
    app.post('/api/sessions/:sessionId/cancel', async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { sessionId } = parseQuery(CancelRequestSchema, req.params);
            const cancelled = await activeAgent.cancel(sessionId);
            if (!cancelled) {
                logger.debug(`No in-flight run to cancel for session: ${sessionId}`);
            }
            return res.status(200).json({ cancelled, sessionId });
        } catch (error) {
            return next(error);
        }
    });

    // Synchronous endpoint: await the full AI response and return it in one go
    // JSON body size limit increased for image/file uploads
    app.post(
        '/api/message-sync',
        express.json({ limit: process.env.MESSAGE_JSON_LIMIT || '10mb' }),
        async (req, res, next) => {
            logger.info('Received message via POST /api/message-sync');
            try {
                ensureAgentAvailable();
                const { message, sessionId, imageData, fileData } = parseBody(
                    MessageRequestSchema,
                    req.body
                );

                // Extract optional image and file data
                const imageDataInput = imageData
                    ? { image: imageData.base64, mimeType: imageData.mimeType }
                    : undefined;

                // Process file data
                const fileDataInput = fileData
                    ? {
                          data: fileData.base64,
                          mimeType: fileData.mimeType,
                          ...(fileData.filename && { filename: fileData.filename }),
                      }
                    : undefined;
                if (imageDataInput) logger.info('Image data included in message.');
                if (fileDataInput) logger.info('File data included in message.');
                if (sessionId) logger.info(`Message for session: ${sessionId}`);

                const response = await activeAgent.run(
                    message || '',
                    imageDataInput,
                    fileDataInput,
                    sessionId,
                    false // Force non-streaming for sync endpoint
                );
                return res.status(200).json({ response, sessionId });
            } catch (error) {
                return next(error);
            }
        }
    );

    const ResetRequestSchema = z.object({
        sessionId: z.string().optional(),
    });
    app.post('/api/reset', express.json(), async (req, res, next) => {
        logger.info('Received request via POST /api/reset');
        try {
            ensureAgentAvailable();
            const { sessionId } = parseBody(ResetRequestSchema, req.body);
            await activeAgent.resetConversation(sessionId);
            return res.status(200).send({ status: 'reset initiated', sessionId });
        } catch (error) {
            return next(error);
        }
    });

    // Dynamic MCP server connection endpoint (legacy)
    const McpServerRequestSchema = z.object({
        name: z.string().min(1, 'Server name is required'),
        config: McpServerConfigSchema,
        persistToAgent: z.boolean().optional(),
    });

    // Add a new MCP server
    app.post('/api/mcp/servers', express.json(), async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { name, config, persistToAgent } = parseBody(McpServerRequestSchema, req.body);

            // Connect the server
            await activeAgent.connectMcpServer(name, config);
            logger.info(`Successfully connected to new server '${name}' via API request.`);

            // If persistToAgent is true, save to agent config file
            if (persistToAgent === true) {
                try {
                    // Get the current effective config to read existing mcpServers
                    const currentConfig = activeAgent.getEffectiveConfig();

                    // Create update with new server added to mcpServers
                    const updates = {
                        mcpServers: {
                            ...(currentConfig.mcpServers || {}),
                            [name]: config,
                        },
                    };

                    await activeAgent.updateAndSaveConfig(updates);
                    logger.info(`Saved server '${name}' to agent configuration file`);
                } catch (saveError) {
                    logger.warn(`Failed to save server '${name}' to agent config:`, saveError);
                    // Don't fail the request if saving fails - server is still connected
                }
            }

            return res.status(200).send({ status: 'connected', name });
        } catch (error) {
            return next(error);
        }
    });

    // Add MCP servers listing endpoint
    app.get('/api/mcp/servers', async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const clientsMap = activeAgent.getMcpClients();
            const failedConnections = activeAgent.getMcpFailedConnections();
            const servers: Array<{ id: string; name: string; status: string }> = [];
            for (const name of clientsMap.keys()) {
                servers.push({ id: name, name, status: 'connected' });
            }
            for (const name of Object.keys(failedConnections)) {
                servers.push({ id: name, name, status: 'error' });
            }
            return res.status(200).json({ servers });
        } catch (error) {
            return next(error);
        }
    });

    // Add MCP server tools listing endpoint
    const ListServerToolsParamsSchema = z.object({
        serverId: z.string().min(1, 'Server ID is required'),
    });
    app.get('/api/mcp/servers/:serverId/tools', async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { serverId } = parseQuery(ListServerToolsParamsSchema, req.params);
            const client = activeAgent.getMcpClients().get(serverId);
            if (!client) {
                return res.status(404).json({ error: `Server '${serverId}' not found` });
            }
            const toolsMap = await client.getTools();
            const tools = Object.entries(toolsMap).map(([toolName, toolDef]) => ({
                id: toolName,
                name: toolName,
                description: toolDef.description || '',
                inputSchema: toolDef.parameters,
            }));
            return res.status(200).json({ tools });
        } catch (error) {
            return next(error);
        }
    });

    // Endpoint to remove/disconnect an MCP server
    const DeleteMcpServerParamsSchema = z.object({
        serverId: z.string().min(1, 'Server ID is required'),
    });
    app.delete('/api/mcp/servers/:serverId', async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { serverId } = parseQuery(DeleteMcpServerParamsSchema, req.params);
            logger.info(`Received request to DELETE /api/mcp/servers/${serverId}`);

            // Check if server exists before attempting to disconnect
            const clientExists =
                activeAgent.getMcpClients().has(serverId) ||
                activeAgent.getMcpFailedConnections()[serverId];
            if (!clientExists) {
                logger.warn(`Attempted to delete non-existent server: ${serverId}`);
                return res.status(404).json({ error: `Server '${serverId}' not found.` });
            }

            await activeAgent.removeMcpServer(serverId);
            return res.status(200).json({ status: 'disconnected', id: serverId });
        } catch (error) {
            return next(error);
        }
    });

    // Endpoint to restart an MCP server
    const RestartMcpServerParamsSchema = z.object({
        serverId: z.string().min(1, 'Server ID is required'),
    });
    app.post('/api/mcp/servers/:serverId/restart', async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { serverId } = parseQuery(RestartMcpServerParamsSchema, req.params);
            logger.info(`Received request to POST /api/mcp/servers/${serverId}/restart`);

            // Check if server exists before attempting to restart
            const clientExists = activeAgent.getMcpClients().has(serverId);
            if (!clientExists) {
                logger.warn(`Attempted to restart non-existent server: ${serverId}`);
                return res.status(404).json({ error: `Server '${serverId}' not found.` });
            }

            await activeAgent.restartMcpServer(serverId);
            return res.status(200).json({ status: 'restarted', id: serverId });
        } catch (error) {
            return next(error);
        }
    });

    // Execute an MCP tool via REST wrapper
    const ExecuteMcpToolParamsSchema = z.object({
        serverId: z.string().min(1, 'Server ID is required'),
        toolName: z.string().min(1, 'Tool name is required'),
    });
    app.post(
        '/api/mcp/servers/:serverId/tools/:toolName/execute',
        express.json(),
        async (req, res, next) => {
            try {
                const { serverId, toolName } = parseQuery(ExecuteMcpToolParamsSchema, req.params);
                // Verify server exists
                const client = activeAgent.getMcpClients().get(serverId);
                if (!client) {
                    return res
                        .status(404)
                        .json({ success: false, error: `Server '${serverId}' not found` });
                }
                // Execute tool directly on the specified server
                const rawResult = await client.callTool(toolName, req.body);
                // Return standardized result shape
                return res.json({ success: true, data: rawResult });
            } catch (error) {
                return next(error);
            }
        }
    );

    // ============= RESOURCE MANAGEMENT ENDPOINTS =============

    // Get all available resources
    app.get('/api/resources', async (_req, res, next) => {
        try {
            ensureAgentAvailable();
            const resources = await activeAgent.listResources();
            return res.status(200).json({ ok: true, resources: Object.values(resources) });
        } catch (error) {
            return next(error);
        }
    });

    // Read resource content
    const ReadResourceContentParamsSchema = z.object({
        resourceId: z
            .string()
            .min(1, 'Resource ID is required')
            .transform((encoded) => decodeUriComponent(encoded)),
    });
    app.get('/api/resources/:resourceId/content', async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { resourceId } = parseQuery(ReadResourceContentParamsSchema, req.params);
            const content = await activeAgent.readResource(resourceId);
            return res.status(200).json({ ok: true, content });
        } catch (error) {
            return next(error);
        }
    });

    // Check if resource exists
    const CheckResourceExistsParamsSchema = z.object({
        resourceId: z
            .string()
            .min(1, 'Resource ID is required')
            .transform((encoded) => decodeUriComponent(encoded)),
    });
    app.head('/api/resources/:resourceId', async (req, res, next) => {
        try {
            const { resourceId } = parseQuery(CheckResourceExistsParamsSchema, req.params);
            const exists = await activeAgent.hasResource(resourceId);
            return res.status(exists ? 200 : 404).end();
        } catch (error) {
            return next(error);
        }
    });

    // List resources for a specific MCP server
    const ListServerResourcesParamsSchema = z.object({
        serverId: z.string().min(1, 'Server ID is required'),
    });
    app.get('/api/mcp/servers/:serverId/resources', async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { serverId } = parseQuery(ListServerResourcesParamsSchema, req.params);
            const resources = await activeAgent.listResourcesForServer(serverId);
            return sendJsonResponse(res, { success: true, resources }, 200);
        } catch (error) {
            return next(error);
        }
    });

    // Read resource content from specific MCP server
    const ReadServerResourceContentParamsSchema = z.object({
        serverId: z.string().min(1, 'Server ID is required'),
        resourceId: z
            .string()
            .min(1, 'Resource ID is required')
            .transform((encoded) => decodeUriComponent(encoded)),
    });
    app.get('/api/mcp/servers/:serverId/resources/:resourceId/content', async (req, res, next) => {
        try {
            const { serverId, resourceId } = parseQuery(
                ReadServerResourceContentParamsSchema,
                req.params
            );
            const qualifiedUri = `mcp:${serverId}:${resourceId}`;
            const content = await activeAgent.readResource(qualifiedUri);
            return sendJsonResponse(res, { success: true, data: { content } }, 200);
        } catch (error) {
            return next(error);
        }
    });

    // WebSocket handling
    // handle inbound client messages over WebSocket
    wss.on('connection', (ws: WebSocket) => {
        logger.info('WebSocket client connected.');

        ws.on('message', async (messageBuffer) => {
            const messageString = messageBuffer.toString();
            try {
                const parsedMessage = JSON.parse(messageString);
                const redactedMessage = redactSensitiveData(parsedMessage);
                logger.debug(`WebSocket received message: ${JSON.stringify(redactedMessage)}`);
            } catch {
                // If JSON parsing fails, redact then log first 200 chars to avoid huge logs
                const redacted = String(redactSensitiveData(messageString));
                const truncated =
                    redacted.length > 200
                        ? `${redacted.substring(0, 200)}... (${redacted.length} total chars)`
                        : redacted;
                logger.debug(`WebSocket received message: ${truncated}`);
            }
            try {
                const data = JSON.parse(messageString);
                if (data.type === 'approvalResponse' && data.data) {
                    // Validate the approval response payload with Zod schema
                    const validationResult = ApprovalResponseSchema.safeParse(data.data);
                    if (!validationResult.success) {
                        logger.warn(
                            `Received invalid approval response payload: ${validationResult.error.message}`
                        );
                        // Do not emit invalid payloads
                        return;
                    }
                    // Route validated approval response back via AgentEventBus
                    activeAgent.agentEventBus.emit('dexto:approvalResponse', validationResult.data);
                    return;
                } else if (
                    data.type === 'message' &&
                    (data.content || data.imageData || data.fileData)
                ) {
                    logger.info(
                        `Processing message from WebSocket: ${data.content ? data.content.substring(0, 50) + '...' : '[image/file only]'}`
                    );
                    const imageDataInput = data.imageData
                        ? { image: data.imageData.base64, mimeType: data.imageData.mimeType }
                        : undefined;

                    // Process file data
                    const fileDataInput = data.fileData
                        ? {
                              data: data.fileData.base64,
                              mimeType: data.fileData.mimeType,
                              ...(data.fileData.filename && { filename: data.fileData.filename }),
                          }
                        : undefined;

                    const sessionId =
                        typeof data.sessionId === 'string' ? (data.sessionId as string) : undefined;
                    if (!sessionId) {
                        logger.error(
                            'Received WebSocket message without sessionId. Dropping message and not sending error (sessionId is mandatory).'
                        );
                        return;
                    }
                    const stream = data.stream === true; // Extract stream preference, default to false
                    if (imageDataInput) logger.info('Image data included in message.');
                    if (fileDataInput) logger.info('File data included in message.');
                    if (sessionId) logger.info(`Message for session: ${sessionId}`);

                    // Check if agent is available before processing
                    try {
                        ensureAgentAvailable();
                        logger.debug('Agent availability check passed');
                    } catch (error) {
                        logger.error(`Agent not available for WebSocket message: ${error}`);
                        sendWebSocketError(
                            ws,
                            error instanceof Error ? error.message : 'Agent not available',
                            sessionId
                        );
                        return;
                    }

                    // Comprehensive input validation
                    logger.debug('Getting effective config for validation');
                    const currentConfig = activeAgent.getEffectiveConfig(sessionId);
                    logger.debug('Validating input for LLM');
                    const validation = validateInputForLLM(
                        {
                            text: data.content,
                            ...(imageDataInput && { imageData: imageDataInput }),
                            ...(fileDataInput && { fileData: fileDataInput }),
                        },
                        {
                            provider: currentConfig.llm.provider,
                            model: currentConfig.llm.model,
                        }
                    );

                    if (!validation.ok) {
                        const redactedIssues = redactSensitiveData(validation.issues);
                        logger.error(`Invalid input for current LLM configuration`, {
                            provider: currentConfig.llm.provider,
                            model: currentConfig.llm.model,
                            issues: redactedIssues,
                        });
                        // Create a hierarchical error structure: generic top-level + detailed nested issues
                        // This allows the UI to show "Invalid input for LLM config" with expandable specifics
                        const hierarchicalError = new DextoValidationError([
                            {
                                code: AgentErrorCode.API_VALIDATION_ERROR,
                                message: 'Invalid input for current LLM configuration',
                                scope: ErrorScope.AGENT,
                                type: ErrorType.USER,
                                severity: 'error' as const,
                                context: {
                                    provider: currentConfig.llm.provider,
                                    model: currentConfig.llm.model,
                                    detailedIssues: validation.issues, // Nest the specific validation details
                                },
                            },
                        ]);
                        // Always include sessionId for client-side routing of errors
                        sendWebSocketError(ws, hierarchicalError, sessionId);
                        return;
                    }

                    logger.debug('Validation passed, calling activeAgent.run()');
                    await activeAgent.run(
                        data.content,
                        imageDataInput,
                        fileDataInput,
                        sessionId,
                        stream
                    );
                    logger.debug('activeAgent.run() completed');
                } else if (data.type === 'reset') {
                    const sessionId = data.sessionId as string | undefined;
                    logger.info(
                        `Processing reset command from WebSocket${sessionId ? ` for session: ${sessionId}` : ''}.`
                    );

                    // Check if agent is available before processing
                    try {
                        ensureAgentAvailable();
                    } catch (error) {
                        logger.error(`Agent not available for WebSocket reset: ${error}`);
                        sendWebSocketError(
                            ws,
                            error instanceof Error ? error.message : 'Agent not available',
                            sessionId || 'unknown'
                        );
                        return;
                    }

                    await activeAgent.resetConversation(sessionId);
                } else if (data.type === 'cancel') {
                    const sessionId = data.sessionId as string | undefined;
                    logger.info(
                        `Processing cancel command from WebSocket${sessionId ? ` for session: ${sessionId}` : ''}.`
                    );

                    // Check if agent is available before processing
                    try {
                        ensureAgentAvailable();
                    } catch (error) {
                        logger.error(`Agent not available for WebSocket cancel: ${error}`);
                        sendWebSocketError(
                            ws,
                            error instanceof Error ? error.message : 'Agent not available',
                            sessionId || 'unknown'
                        );
                        return;
                    }

                    const cancelled = await activeAgent.cancel(sessionId);
                    if (!cancelled) {
                        logger.debug('No in-flight run to cancel');
                    }
                } else {
                    logger.warn(`Received unknown WebSocket message type: ${data.type}`);
                    if (typeof data.sessionId === 'string') {
                        sendWebSocketValidationError(ws, 'Unknown message type', data.sessionId, {
                            messageType: data.type,
                        });
                    } else {
                        // No session id; log only.
                        logger.error(
                            'Cannot send error for unknown message type without sessionId.'
                        );
                    }
                }
            } catch (error) {
                logger.error(
                    `Error processing WebSocket message: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
                // Try to parse sessionId; if absent, do not send an error (cannot route it reliably)
                try {
                    const maybe = JSON.parse(messageBuffer.toString());
                    if (typeof maybe.sessionId === 'string') {
                        sendWebSocketError(ws, error, maybe.sessionId);
                    } else {
                        logger.error(
                            'Cannot send WebSocket error without sessionId. Error will be logged only.'
                        );
                    }
                } catch {
                    logger.error(
                        'Cannot parse incoming message to extract sessionId for error reporting.'
                    );
                }
            }
        });
        ws.on('close', () => {
            logger.info('WebSocket client disconnected.');
        });
        ws.on('error', (error) => {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`WebSocket error: ${errorMessage}`);
        });
    });

    // Apply agentCard overrides (if any)
    // TODO: This is a temporary solution to allow for agentCard overrides. Implement a more robust solution in the future.
    const overrides = agentCardOverride ?? {};
    const resolvedPort =
        typeof listenPort === 'number' ? listenPort : Number(process.env.PORT || 3000);
    const baseApiUrl = process.env.DEXTO_BASE_URL || `http://localhost:${resolvedPort}`;
    let agentCardData = createAgentCard(
        {
            defaultName: overrides.name ?? 'dexto',
            defaultVersion: overrides.version ?? '1.0.0',
            defaultBaseUrl: baseApiUrl,
            webSubscriber,
        },
        overrides
    );
    const _agentName = agentCardData.name;
    const _agentVersion = agentCardData.version;

    // Setup A2A routes
    setupA2ARoutes(app, () => agentCardData);

    // Setup Memory routes
    app.use(
        '/api/memory',
        setupMemoryRoutes(() => activeAgent)
    );

    // --- Initialize and Setup MCP Server and Endpoints ---
    // Get transport type from environment variable or default to http
    try {
        const transportType = (process.env.DEXTO_MCP_TRANSPORT_TYPE as McpTransportType) || 'http';
        const mcpTransport = await createMcpTransport(transportType);

        const mcpServer = await initializeMcpServer(
            () => activeAgent,
            () => agentCardData,
            mcpTransport
        );
        await initializeMcpServerApiEndpoints(app, mcpTransport, mcpServer);
    } catch (error: any) {
        logger.error(`Failed to initialize MCP server: ${error.message}`);
        // Add error middleware to handle the failure gracefully
        app.use((req, res) => {
            res.status(500).json({ error: 'MCP server initialization failed' });
        });
    }

    // ===== Agents API =====

    // TODO: Consider moving to AgentRegistry.getAgentInfo() if this pattern is needed
    // outside of API response formatting (e.g., in CLI commands, WebUI hooks, client SDK)
    /**
     * Helper to resolve agent ID to { id, name } by looking up in registry
     * @param agentId - The agent ID to resolve
     * @returns Object with id and name (uses deriveDisplayName as fallback)
     */
    async function resolveAgentInfo(agentId: string): Promise<{ id: string; name: string }> {
        const agents = await Dexto.listAgents();
        const agent =
            agents.installed.find((a) => a.id === agentId) ??
            agents.available.find((a) => a.id === agentId);
        return {
            id: agentId,
            name: agent?.name ?? deriveDisplayName(agentId),
        };
    }

    app.get('/api/agents', async (_req, res, next) => {
        try {
            const agents = await Dexto.listAgents();
            const currentId = activeAgentId ?? null;
            return sendJsonResponse(res, {
                installed: agents.installed,
                available: agents.available,
                current: currentId ? await resolveAgentInfo(currentId) : { id: null, name: null },
            });
        } catch (error) {
            return next(error);
        }
    });

    app.get('/api/agents/current', async (_req, res, next) => {
        try {
            const currentId = activeAgentId ?? null;
            if (!currentId) {
                return sendJsonResponse(res, { id: null, name: null });
            }
            return sendJsonResponse(res, await resolveAgentInfo(currentId));
        } catch (error) {
            return next(error);
        }
    });

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

    // Schema for custom agent installation (CLI/automation entrypoint)
    const CustomAgentInstallSchema = z
        .object({
            id: z.string().min(1, 'Agent id is required').describe('Unique agent identifier'),
            name: z.string().optional().describe('Display name (defaults to derived from id)'),
            sourcePath: z.string().min(1).describe('Path to agent configuration file or directory'),
            metadata: z
                .object({
                    description: z
                        .string()
                        .min(1)
                        .describe('Human-readable description of the agent'),
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

    app.post('/api/agents/install', express.json(), async (req, res, next) => {
        try {
            // Check if this is a custom agent installation (has sourcePath and metadata)
            if (req.body.sourcePath && req.body.metadata) {
                const { id, displayName, sourcePath, metadata, injectPreferences } =
                    CustomAgentInstallSchema.parse(req.body);

                // Clean metadata to match exact optional property types
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
                return sendJsonResponse(
                    res,
                    { installed: true, id, name: displayName, type: 'custom' },
                    201
                );
            } else {
                // Registry agent installation
                const { id } = parseBody(AgentIdentifierSchema, req.body);
                await Dexto.installAgent(id);
                const agentInfo = await resolveAgentInfo(id);
                return sendJsonResponse(
                    res,
                    {
                        installed: true,
                        ...agentInfo,
                        type: 'builtin',
                    },
                    201
                );
            }
        } catch (error) {
            return next(error);
        }
    });

    app.post('/api/agents/switch', express.json(), async (req, res, next) => {
        try {
            const { id, path } = parseBody(AgentIdentifierSchema, req.body);

            // Route based on presence of path parameter
            const result = path ? await switchAgentByPath(path) : await switchAgentById(id);

            return sendJsonResponse(res, { switched: true, ...result });
        } catch (error) {
            return next(error);
        }
    });

    app.post('/api/agents/validate-name', express.json(), async (req, res, next) => {
        try {
            const { id } = parseBody(AgentIdentifierSchema, req.body);
            const agents = await Dexto.listAgents();

            // Check if name exists in installed agents
            const installedAgent = agents.installed.find((a) => a.id === id);
            if (installedAgent) {
                return sendJsonResponse(res, {
                    valid: false,
                    conflict: installedAgent.type,
                    message: `Agent id '${id}' already exists (${installedAgent.type})`,
                });
            }

            // Check if name exists in available agents (registry)
            const availableAgent = agents.available.find((a) => a.id === id);
            if (availableAgent) {
                return sendJsonResponse(res, {
                    valid: false,
                    conflict: availableAgent.type,
                    message: `Agent id '${id}' conflicts with ${availableAgent.type} agent`,
                });
            }

            return sendJsonResponse(res, { valid: true });
        } catch (error) {
            return next(error);
        }
    });

    app.post('/api/agents/uninstall', express.json(), async (req, res, next) => {
        try {
            const { id, force } = parseBody(UninstallAgentSchema, req.body);
            await Dexto.uninstallAgent(id, force);
            return sendJsonResponse(res, { uninstalled: true, id });
        } catch (error) {
            return next(error);
        }
    });

    // Schema for creating custom agents via UI
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
            name: z
                .string()
                .min(1, 'Agent name is required')
                .describe('Display name for the agent'),
            description: z
                .string()
                .min(1, 'Description is required')
                .describe('One-line description of the agent'),
            author: z.string().optional().describe('Author or organization'),
            tags: z.array(z.string()).default([]).describe('Tags for discovery'),
            // Full agent configuration
            config: AgentConfigSchema.describe('Complete agent configuration'),
        })
        .strict();

    // Create a new custom agent from UI
    app.post('/api/agents/custom/create', express.json(), async (req, res, next) => {
        try {
            const { id, name, description, author, tags, config } = parseBody(
                CustomAgentCreateSchema,
                req.body
            );

            // Handle API key: if it's a raw key, store securely and use env var reference
            const provider: LLMProvider = config.llm.provider;
            let agentConfig = config;

            if (config.llm.apiKey && !config.llm.apiKey.startsWith('$')) {
                // Raw API key provided - store securely and get env var reference
                const meta = await saveProviderApiKey(provider, config.llm.apiKey, process.cwd());
                const apiKeyRef = `$${meta.envVar}`;
                logger.info(
                    `Stored API key securely for ${provider}, using env var: ${meta.envVar}`
                );
                // Update config with env var reference
                agentConfig = {
                    ...config,
                    llm: {
                        ...config.llm,
                        apiKey: apiKeyRef,
                    },
                };
            } else if (!config.llm.apiKey) {
                // No API key provided, use default env var
                agentConfig = {
                    ...config,
                    llm: {
                        ...config.llm,
                        apiKey: `$${getPrimaryApiKeyEnvVar(provider)}`,
                    },
                };
            }

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

                return sendJsonResponse(res, { created: true, id, name }, 201);
            } catch (installError) {
                // Clean up temp file on error
                await fs.unlink(tmpFile).catch(() => {});
                throw installError;
            }
        } catch (error) {
            return next(error);
        }
    });

    // Configuration export endpoint
    // Get default greeting (for UI consumption)
    const GetGreetingQuerySchema = z.object({
        sessionId: z.string().optional(),
    });
    app.get('/api/greeting', async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { sessionId } = parseQuery(GetGreetingQuerySchema, req.query);
            const config = activeAgent.getEffectiveConfig(sessionId);
            res.json({ greeting: config.greeting });
        } catch (error) {
            return next(error);
        }
    });

    // ============= AGENT CONFIGURATION MANAGEMENT =============

    // Get agent file path
    app.get('/api/agent/path', async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const agentPath = activeAgent.getAgentFilePath();

            const relativePath = path.basename(agentPath);
            const ext = path.extname(agentPath);
            const name = path.basename(agentPath, ext);

            res.json({
                path: agentPath,
                relativePath,
                name,
                isDefault: name === 'default-agent',
            });
        } catch (error) {
            return next(error);
        }
    });

    // Get editable agent configuration (non-redacted YAML)
    app.get('/api/agent/config', async (req, res, next) => {
        try {
            ensureAgentAvailable();

            // Get the agent file path being used
            const agentPath = activeAgent.getAgentFilePath();

            // Read raw YAML from file (not expanded env vars)
            const yamlContent = await fs.readFile(agentPath, 'utf-8');

            // Get metadata
            const stats = await fs.stat(agentPath);

            res.json({
                yaml: yamlContent,
                path: agentPath,
                relativePath: path.basename(agentPath),
                lastModified: stats.mtime,
                warnings: [
                    'Environment variables ($VAR) will be resolved at runtime',
                    'API keys should use environment variables',
                ],
            });
        } catch (error) {
            return next(error);
        }
    });

    // Validate agent configuration without saving
    const AgentConfigValidateSchema = z.object({
        yaml: z.string().min(1, 'YAML content is required'),
    });
    app.post('/api/agent/validate', express.json(), async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { yaml } = parseBody(AgentConfigValidateSchema, req.body);

            // Parse YAML
            let parsed;
            try {
                parsed = yamlParse(yaml);
            } catch (parseError: any) {
                return res.json({
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

                return res.json({
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

            res.json({
                valid: true,
                errors: [],
                warnings,
            });
        } catch (error) {
            return next(error);
        }
    });

    // Save agent configuration
    const AgentConfigSaveSchema = z.object({
        yaml: z.string().min(1, 'YAML content is required'),
    });
    app.post('/api/agent/config', express.json(), async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { yaml } = parseBody(AgentConfigSaveSchema, req.body);

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
            const agentPath = activeAgent.getAgentFilePath();

            // Create backup
            const backupPath = `${agentPath}.backup`;
            await fs.copyFile(agentPath, backupPath);

            try {
                // Write new config
                await fs.writeFile(agentPath, yaml, 'utf-8');

                // Reload configuration to detect what changed
                const reloadResult = await activeAgent.reloadConfig();

                // If any changes require restart, automatically restart the agent
                if (reloadResult.restartRequired.length > 0) {
                    logger.info(
                        `Auto-restarting agent to apply changes: ${reloadResult.restartRequired.join(', ')}`
                    );

                    await activeAgent.restart();
                    logger.info(
                        'Agent restarted successfully with all event subscribers reconnected'
                    );
                }

                // Clean up backup file after successful save
                await fs.unlink(backupPath).catch(() => {
                    // Ignore errors if backup file doesn't exist
                });

                logger.info(`Agent configuration saved and applied: ${agentPath}`);

                res.json({
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
            } catch (writeError) {
                // Restore backup on error
                await fs.copyFile(backupPath, agentPath);
                throw writeError;
            }
        } catch (error) {
            return next(error);
        }
    });

    // Export effective agent configuration (with masked secrets)
    const ExportConfigQuerySchema = z.object({
        sessionId: z.string().optional(),
    });
    app.get('/api/agent/config/export', async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { sessionId } = parseQuery(ExportConfigQuerySchema, req.query);
            const config = activeAgent.getEffectiveConfig(sessionId);

            // Export config as YAML, masking sensitive data
            const maskedConfig = {
                ...config,
                llm: {
                    ...config.llm,
                    apiKey: config.llm.apiKey ? '[REDACTED]' : undefined,
                },
                mcpServers: redactMcpServersConfig(config.mcpServers),
            };

            const yamlStr = yamlStringify(maskedConfig);
            res.set('Content-Type', 'application/x-yaml');
            res.send(yamlStr);
        } catch (error) {
            return next(error);
        }
    });

    // ============= LLM MANAGEMENT =============

    // Get current LLM configuration
    const GetCurrentLLMQuerySchema = z.object({
        sessionId: z.string().optional(),
    });
    app.get('/api/llm/current', async (req, res, next) => {
        try {
            const { sessionId } = parseQuery(GetCurrentLLMQuerySchema, req.query);

            // Use session-specific config if sessionId is provided, otherwise use default
            const currentConfig = sessionId
                ? activeAgent.getEffectiveConfig(sessionId).llm
                : activeAgent.getCurrentLLMConfig();

            // Attach displayName for the current model if available in registry
            let displayName: string | undefined;
            try {
                const model = LLM_REGISTRY[currentConfig.provider]?.models.find(
                    (m) => m.name.toLowerCase() === String(currentConfig.model).toLowerCase()
                );
                displayName = model?.displayName || undefined;
            } catch (_) {
                // ignore
            }

            res.json({ config: { ...currentConfig, ...(displayName ? { displayName } : {}) } });
        } catch (error) {
            return next(error);
        }
    });

    // LLM Catalog: providers, models, and API key presence (with filters)
    const LLMCatalogQuerySchema = z.object({
        provider: z
            .union([z.string(), z.array(z.string())])
            .optional()
            .transform((value): string[] | undefined =>
                Array.isArray(value) ? value : value ? value.split(',') : undefined
            ),
        hasKey: z
            .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
            .optional()
            .transform((raw): boolean | undefined =>
                raw === 'true' || raw === '1'
                    ? true
                    : raw === 'false' || raw === '0'
                      ? false
                      : undefined
            ),
        router: z.enum(LLM_ROUTERS).optional(),
        fileType: z.enum(SUPPORTED_FILE_TYPES).optional(),
        defaultOnly: z
            .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
            .optional()
            .transform((raw): boolean | undefined =>
                raw === 'true' || raw === '1'
                    ? true
                    : raw === 'false' || raw === '0'
                      ? false
                      : undefined
            ),
        mode: z.enum(['grouped', 'flat']).default('grouped'),
    });
    app.get('/api/llm/catalog', async (req, res, next) => {
        try {
            type ProviderCatalog = Pick<
                ProviderInfo,
                'supportedRouters' | 'models' | 'supportedFileTypes'
            > & {
                name: string;
                hasApiKey: boolean;
                primaryEnvVar: string;
                supportsBaseURL: boolean;
            };

            type ModelFlat = ProviderCatalog['models'][number] & { provider: LLMProvider };

            const queryParams: z.output<typeof LLMCatalogQuerySchema> = LLMCatalogQuerySchema.parse(
                req.query
            );

            const providers: Record<string, ProviderCatalog> = {};
            for (const provider of LLM_PROVIDERS) {
                const info = LLM_REGISTRY[provider];
                const displayName = provider.charAt(0).toUpperCase() + provider.slice(1);
                const keyStatus = getProviderKeyStatus(provider);

                providers[provider] = {
                    name: displayName,
                    hasApiKey: keyStatus.hasApiKey,
                    primaryEnvVar: keyStatus.envVar,
                    supportedRouters: getSupportedRoutersForProvider(provider),
                    supportsBaseURL: supportsBaseURL(provider),
                    models: info.models,
                    supportedFileTypes: info.supportedFileTypes,
                };
            }

            // --- Apply filters ---
            let filtered: Record<string, ProviderCatalog> = { ...providers };

            // provider filter
            if (queryParams.provider && queryParams.provider.length > 0) {
                const allowedProviders = new Set(
                    queryParams.provider.filter((p) =>
                        (LLM_PROVIDERS as readonly string[]).includes(p)
                    )
                );
                const filteredByProvider: Record<string, ProviderCatalog> = {};
                for (const providerId of Object.keys(filtered)) {
                    const providerCatalog = filtered[providerId];
                    if (providerCatalog && allowedProviders.has(providerId)) {
                        filteredByProvider[providerId] = providerCatalog;
                    }
                }
                filtered = filteredByProvider;
            }

            // hasKey filter
            if (typeof queryParams.hasKey === 'boolean') {
                const filteredByKey: Record<string, ProviderCatalog> = {};
                for (const [providerId, providerCatalog] of Object.entries(filtered)) {
                    if (providerCatalog.hasApiKey === queryParams.hasKey) {
                        filteredByKey[providerId] = providerCatalog;
                    }
                }
                filtered = filteredByKey;
            }

            // router filter (keep providers that support router and filter models)
            if (queryParams.router) {
                const filteredByRouter: Record<string, ProviderCatalog> = {};
                for (const [providerId, providerCatalog] of Object.entries(filtered)) {
                    if (!providerCatalog.supportedRouters.includes(queryParams.router)) continue;
                    const models = providerCatalog.models.filter((model) =>
                        isRouterSupportedForModel(
                            providerId as LLMProvider,
                            model.name,
                            queryParams.router!
                        )
                    );
                    if (models.length > 0)
                        filteredByRouter[providerId] = { ...providerCatalog, models };
                }
                filtered = filteredByRouter;
            }

            // fileType filter
            if (queryParams.fileType) {
                const filteredByFileType: Record<string, ProviderCatalog> = {};
                for (const [providerId, providerCatalog] of Object.entries(filtered)) {
                    const models = providerCatalog.models.filter((model) => {
                        const modelTypes =
                            Array.isArray(model.supportedFileTypes) &&
                            model.supportedFileTypes.length > 0
                                ? model.supportedFileTypes
                                : providerCatalog.supportedFileTypes || [];
                        return modelTypes.includes(queryParams.fileType!);
                    });
                    if (models.length > 0)
                        filteredByFileType[providerId] = { ...providerCatalog, models };
                }
                filtered = filteredByFileType;
            }

            // defaultOnly filter
            if (queryParams.defaultOnly) {
                const filteredByDefault: Record<string, ProviderCatalog> = {};
                for (const [providerId, providerCatalog] of Object.entries(filtered)) {
                    const models = providerCatalog.models.filter((model) => model.default === true);
                    if (models.length > 0)
                        filteredByDefault[providerId] = { ...providerCatalog, models };
                }
                filtered = filteredByDefault;
            }

            // mode
            if (queryParams.mode === 'flat') {
                const flat: ModelFlat[] = [];
                for (const [providerId, providerCatalog] of Object.entries(filtered)) {
                    for (const model of providerCatalog.models) {
                        flat.push({ provider: providerId as LLMProvider, ...model });
                    }
                }
                return sendJsonResponse(res, { models: flat }, 200);
            }

            return sendJsonResponse(res, { providers: filtered }, 200);
        } catch (error) {
            return next(error);
        }
    });

    // Save provider API key (never echoes the key back)
    const SaveProviderApiKeyBodySchema = z.object({
        provider: z.enum(LLM_PROVIDERS),
        apiKey: z.string().min(1, 'API key is required'),
    });
    app.post('/api/llm/key', express.json({ limit: '4kb' }), async (req, res, next) => {
        try {
            const body = parseBody(SaveProviderApiKeyBodySchema, req.body);

            const meta = await saveProviderApiKey(body.provider, body.apiKey, process.cwd());
            return sendJsonResponse(
                res,
                { ok: true, provider: body.provider, envVar: meta.envVar },
                200
            );
        } catch (error) {
            return next(error);
        }
    });

    // Switch LLM configuration
    const SwitchLLMBodySchema = z
        .object({
            sessionId: z.string().optional(),
        })
        .passthrough(); // Allow additional LLM config fields
    app.post('/api/llm/switch', express.json(), async (req, res, next) => {
        try {
            const parsed = parseBody(SwitchLLMBodySchema, req.body);
            const { sessionId, ...llmCandidate } = parsed;
            const llmConfig = LLMUpdatesSchema.parse(llmCandidate);
            const config = await activeAgent.switchLLM(llmConfig, sessionId);
            return res.status(200).json({ config, sessionId });
        } catch (error) {
            return next(error);
        }
    });

    // Session Management APIs

    // List all active sessions
    app.get('/api/sessions', async (_req, res, next) => {
        try {
            const sessionIds = await activeAgent.listSessions();
            const sessions = await Promise.all(
                sessionIds.map(async (id) => {
                    try {
                        const metadata = await activeAgent.getSessionMetadata(id);
                        return {
                            id,
                            createdAt: metadata?.createdAt || null,
                            lastActivity: metadata?.lastActivity || null,
                            messageCount: metadata?.messageCount || 0,
                            title: metadata?.title || null,
                        };
                    } catch (_error) {
                        // Skip sessions that no longer exist
                        return {
                            id,
                            createdAt: null,
                            lastActivity: null,
                            messageCount: 0,
                            title: null,
                        };
                    }
                })
            );
            return res.json({ sessions });
        } catch (error) {
            return next(error);
        }
    });

    // Create a new session
    const CreateSessionBodySchema = z.object({
        sessionId: z.string().optional(),
    });
    app.post('/api/sessions', express.json(), async (req, res, next) => {
        try {
            const { sessionId } = parseBody(CreateSessionBodySchema, req.body);
            const session = await activeAgent.createSession(sessionId);
            const metadata = await activeAgent.getSessionMetadata(session.id);
            return res.status(201).json({
                session: {
                    id: session.id,
                    createdAt: metadata?.createdAt || Date.now(),
                    lastActivity: metadata?.lastActivity || Date.now(),
                    messageCount: metadata?.messageCount || 0,
                    title: metadata?.title || null,
                },
            });
        } catch (error) {
            return next(error);
        }
    });

    // Get current working session (must come before parameterized route)
    app.get('/api/sessions/current', async (_req, res, next) => {
        try {
            const currentSessionId = activeAgent.getCurrentSessionId();
            return res.json({ currentSessionId });
        } catch (error) {
            return next(error);
        }
    });

    // Get session details
    const GetSessionDetailsParamsSchema = z.object({
        sessionId: z.string().min(1, 'Session ID is required'),
    });
    app.get('/api/sessions/:sessionId', async (req, res, next) => {
        try {
            const { sessionId } = parseQuery(GetSessionDetailsParamsSchema, req.params);
            const metadata = await activeAgent.getSessionMetadata(sessionId);
            const history = await activeAgent.getSessionHistory(sessionId);

            return res.json({
                session: {
                    id: sessionId,
                    createdAt: metadata?.createdAt || null,
                    lastActivity: metadata?.lastActivity || null,
                    messageCount: metadata?.messageCount || 0,
                    title: metadata?.title || null,
                    history: history.length,
                },
            });
        } catch (error) {
            return next(error);
        }
    });

    // Get session conversation history
    const GetSessionHistoryParamsSchema = z.object({
        sessionId: z.string().min(1, 'Session ID is required'),
    });
    app.get('/api/sessions/:sessionId/history', async (req, res, next) => {
        try {
            const { sessionId } = parseQuery(GetSessionHistoryParamsSchema, req.params);
            // getSessionHistory already checks existence via getSession
            const history = await activeAgent.getSessionHistory(sessionId);
            return res.json({ history });
        } catch (error) {
            return next(error);
        }
    });

    // Search messages across all sessions or within a specific session
    const SearchQuerySchema = z.object({
        q: z.string().min(1, 'Search query is required'),
        limit: z.coerce.number().min(1).max(100).optional(),
        offset: z.coerce.number().min(0).optional(),
        sessionId: z.string().optional(),
        role: z.enum(['user', 'assistant', 'system', 'tool']).optional(),
    });
    app.get('/api/search/messages', async (req, res, next) => {
        try {
            const {
                q: query,
                limit,
                offset,
                sessionId,
                role,
            } = parseQuery(SearchQuerySchema, req.query);

            const options = {
                limit: limit || 20,
                offset: offset || 0,
                ...(sessionId && { sessionId }),
                ...(role && { role }),
            };

            const searchResults = await activeAgent.searchMessages(query, options);
            return sendJsonResponse(res, searchResults);
        } catch (error) {
            return next(error);
        }
    });

    // Search sessions that contain the query
    const SearchSessionsQuerySchema = z.object({
        q: z.string().min(1, 'Search query is required'),
    });
    app.get('/api/search/sessions', async (req, res, next) => {
        try {
            const { q: query } = parseQuery(SearchSessionsQuerySchema, req.query);
            const searchResults = await activeAgent.searchSessions(query);
            return sendJsonResponse(res, searchResults);
        } catch (error) {
            return next(error);
        }
    });

    // Delete a session
    const DeleteSessionParamsSchema = z.object({
        sessionId: z.string().min(1, 'Session ID is required'),
    });
    app.delete('/api/sessions/:sessionId', async (req, res, next) => {
        try {
            const { sessionId } = parseQuery(DeleteSessionParamsSchema, req.params);
            // deleteSession already checks existence internally
            await activeAgent.deleteSession(sessionId);
            return res.json({ status: 'deleted', sessionId });
        } catch (error) {
            return next(error);
        }
    });

    // Rename session title
    const PatchSessionBodySchema = z.object({
        title: z.string().min(1, 'Title is required').max(120, 'Title too long'),
    });
    const PatchSessionParamsSchema = z.object({
        sessionId: z.string().min(1, 'Session ID is required'),
    });
    app.patch('/api/sessions/:sessionId', express.json(), async (req, res, next) => {
        try {
            const { sessionId } = parseQuery(PatchSessionParamsSchema, req.params);
            const { title } = parseBody(PatchSessionBodySchema, req.body);
            await activeAgent.setSessionTitle(sessionId, title);
            const metadata = await activeAgent.getSessionMetadata(sessionId);
            return res.json({
                session: {
                    id: sessionId,
                    createdAt: metadata?.createdAt || null,
                    lastActivity: metadata?.lastActivity || null,
                    messageCount: metadata?.messageCount || 0,
                    title: metadata?.title || title,
                },
            });
        } catch (error) {
            return next(error);
        }
    });

    // Load session as current working session and set as default
    const LoadSessionParamsSchema = z.object({
        sessionId: z.string().min(1, 'Session ID is required'),
    });
    app.post('/api/sessions/:sessionId/load', async (req, res, next) => {
        try {
            const { sessionId } = parseQuery(LoadSessionParamsSchema, req.params);

            // Handle null/reset case
            if (sessionId === 'null' || sessionId === 'undefined') {
                await activeAgent.loadSessionAsDefault(null);
                res.json({
                    status: 'reset',
                    sessionId: null,
                    currentSession: activeAgent.getCurrentSessionId(),
                });
                return;
            }

            // loadSession already checks session existence
            await activeAgent.loadSessionAsDefault(sessionId);
            return res.json({
                status: 'loaded',
                sessionId,
                currentSession: activeAgent.getCurrentSessionId(),
            });
        } catch (error) {
            return next(error);
        }
    });

    // Webhook Management APIs

    // Register a new webhook endpoint
    const WebhookRequestSchema = z.object({
        url: z.string().url('Invalid URL format'),
        secret: z.string().optional(),
        description: z.string().optional(),
    });
    app.post('/api/webhooks', express.json(), async (req, res, next) => {
        try {
            const { url, secret, description } = parseBody(WebhookRequestSchema, req.body);

            // Generate unique webhook ID
            const webhookId = `wh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            const webhook: WebhookConfig = {
                id: webhookId,
                url,
                createdAt: new Date(),
                ...(secret && { secret }),
                ...(description && { description }),
            };

            webhookSubscriber.addWebhook(webhook);

            logger.info(`Webhook registered: ${webhookId} -> ${url}`);

            return sendJsonResponse(
                res,
                {
                    webhook: {
                        id: webhook.id,
                        url: webhook.url,
                        description: webhook.description,
                        createdAt: webhook.createdAt,
                    },
                },
                201
            );
        } catch (error) {
            return next(error);
        }
    });

    // List all registered webhooks
    app.get('/api/webhooks', async (_req, res, next) => {
        try {
            const webhooks = webhookSubscriber.getWebhooks().map((webhook: WebhookConfig) => ({
                id: webhook.id,
                url: webhook.url,
                description: webhook.description,
                createdAt: webhook.createdAt,
            }));

            return sendJsonResponse(res, { webhooks });
        } catch (error) {
            return next(error);
        }
    });

    // Get a specific webhook
    const GetWebhookParamsSchema = z.object({
        webhookId: z.string().min(1, 'Webhook ID is required'),
    });
    app.get('/api/webhooks/:webhookId', async (req, res, next) => {
        try {
            const { webhookId } = parseQuery(GetWebhookParamsSchema, req.params);
            const webhook = webhookSubscriber.getWebhook(webhookId);

            if (!webhook) {
                return res.status(404).json({ error: 'Webhook not found' });
            }

            return sendJsonResponse(res, {
                webhook: {
                    id: webhook.id,
                    url: webhook.url,
                    description: webhook.description,
                    createdAt: webhook.createdAt,
                },
            });
        } catch (error) {
            return next(error);
        }
    });

    // Remove a webhook endpoint
    const DeleteWebhookParamsSchema = z.object({
        webhookId: z.string().min(1, 'Webhook ID is required'),
    });
    app.delete('/api/webhooks/:webhookId', async (req, res, next) => {
        try {
            const { webhookId } = parseQuery(DeleteWebhookParamsSchema, req.params);
            const removed = webhookSubscriber.removeWebhook(webhookId);

            if (!removed) {
                return res.status(404).json({ error: 'Webhook not found' });
            }

            logger.info(`Webhook removed: ${webhookId}`);
            return res.json({ status: 'removed', webhookId });
        } catch (error) {
            return next(error);
        }
    });

    // Test a webhook endpoint
    const TestWebhookParamsSchema = z.object({
        webhookId: z.string().min(1, 'Webhook ID is required'),
    });
    app.post('/api/webhooks/:webhookId/test', async (req, res, next) => {
        try {
            const { webhookId } = parseQuery(TestWebhookParamsSchema, req.params);
            const webhook = webhookSubscriber.getWebhook(webhookId);

            if (!webhook) {
                return res.status(404).json({ error: 'Webhook not found' });
            }

            logger.info(`Testing webhook: ${webhookId}`);
            const result = await webhookSubscriber.testWebhook(webhookId);

            return sendJsonResponse(res, {
                test: 'completed',
                result: {
                    success: result.success,
                    statusCode: result.statusCode,
                    responseTime: result.responseTime,
                    error: result.error,
                },
            });
        } catch (error) {
            return next(error);
        }
    });
    // Centralized error handling (must be registered after routes)
    app.use(errorHandler);

    return { app, server, wss, webSubscriber, webhookSubscriber };
}

export async function startApiServer(
    agent: DextoAgent,
    port = 3000,
    agentCardOverride?: Partial<AgentCard>,
    agentId?: string
) {
    if (shouldUseExpressServer()) {
        console.log('🌐 USING EXPRESS SERVER');
        const { server, wss, webSubscriber, webhookSubscriber } = await initializeApi(
            agent,
            agentCardOverride,
            port,
            agentId
        );

        // API server for REST endpoints and WebSocket connections
        server.listen(port, '0.0.0.0', () => {
            const networkInterfaces = os.networkInterfaces();
            let localIp = 'localhost';
            Object.values(networkInterfaces).forEach((ifaceList) => {
                ifaceList?.forEach((iface) => {
                    if (iface.family === 'IPv4' && !iface.internal) {
                        localIp = iface.address;
                    }
                });
            });

            logger.info(
                `API server started successfully. Accessible at: http://localhost:${port} and http://${localIp}:${port} on your local network.`,
                null,
                'green'
            );
        });

        return { server, wss, webSubscriber, webhookSubscriber };
    }

    // Default to Hono
    console.log('🌐 USING HONO SERVER');
    const { startHonoApiServer } = await import('./server-hono.js');
    return startHonoApiServer(agent, port, agentCardOverride, agentId);
}

export function shouldUseExpressServer(): boolean {
    const flag = (process.env.DEXTO_USE_EXPRESS ?? '').toLowerCase();
    return flag === '1' || flag === 'true' || flag === 'yes';
}
