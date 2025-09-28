import express from 'express';
import type { Express } from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { WebSocketEventSubscriber } from './websocket-subscriber.js';
import { WebhookEventSubscriber } from './webhook-subscriber.js';
import type { WebhookConfig } from './webhook-types.js';
import { logger, redactSensitiveData, type AgentCard } from '@dexto/core';
import { setupA2ARoutes } from './a2a.js';
import {
    createMcpTransport,
    initializeMcpServer,
    initializeMcpServerApiEndpoints,
    type McpTransportType,
} from './mcp/mcp_handler.js';
import { createAgentCard, DextoAgent } from '@dexto/core';
import { stringify as yamlStringify } from 'yaml';
import os from 'os';
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
import { getProviderKeyStatus, saveProviderApiKey } from '@dexto/core';
import { errorHandler } from './middleware/errorHandler.js';
import { McpServerConfigSchema } from '@dexto/core';
import { sendWebSocketError, sendWebSocketValidationError } from './websocket-error-handler.js';
import {
    DextoValidationError,
    ErrorScope,
    ErrorType,
    AgentErrorCode,
    AgentError,
} from '@dexto/core';

/**
 * Helper function to send JSON response with optional pretty printing
 */
function sendJsonResponse(res: any, data: any, statusCode = 200) {
    const pretty = res.req.query.pretty === 'true' || res.req.query.pretty === '1';
    res.status(statusCode);

    if (pretty) {
        res.set('Content-Type', 'application/json');
        res.send(JSON.stringify(data, null, 2));
    } else {
        res.json(data);
    }
}

// Note: Request body may include a sessionId alongside LLM updates.
// We parse sessionId separately and validate the rest against LLMUpdatesSchema

/**
 * API request validation schemas based on actual usage
 */
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

// Reuse existing MCP server config schema
const McpServerRequestSchema = z.object({
    name: z.string().min(1, 'Server name is required'),
    config: McpServerConfigSchema,
});

// Based on existing WebhookRegistrationRequest interface
const WebhookRequestSchema = z.object({
    url: z.string().url('Invalid URL format'),
    secret: z.string().optional(),
    description: z.string().optional(),
});

// Schema for search query parameters
const SearchQuerySchema = z.object({
    q: z.string().min(1, 'Search query is required'),
    limit: z.coerce.number().min(1).max(100).optional(),
    offset: z.coerce.number().min(0).optional(),
    sessionId: z.string().optional(),
    role: z.enum(['user', 'assistant', 'system', 'tool']).optional(),
});

// Schema for cancel request parameters
const CancelRequestSchema = z.object({
    sessionId: z.string().min(1, 'Session ID is required'),
});

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
    agentName?: string
): Promise<{
    app: Express;
    server: http.Server;
    wss: WebSocketServer;
    webSubscriber: WebSocketEventSubscriber;
    webhookSubscriber: WebhookEventSubscriber;
}> {
    const app = express();
    registerGracefulShutdown(agent);
    // this will apply middleware to all /api/llm/* routes
    app.use('/api/llm', expressRedactionMiddleware);
    app.use('/api/config.yaml', expressRedactionMiddleware);

    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    // set up event broadcasting over WebSocket
    // Track active agent and identifier for switch/install APIs
    let activeAgent: DextoAgent = agent;
    let activeAgentName: string | undefined = agentName || 'default';
    let isSwitchingAgent = false;

    logger.info(`Initializing API server with agent: ${activeAgentName}`);

    // Ensure the initial agent is started
    if (!activeAgent.isStarted() && !activeAgent.isStopped()) {
        logger.info('Starting initial agent...');
        await activeAgent.start();
    } else if (activeAgent.isStopped()) {
        logger.warn('Initial agent is stopped, this may cause issues');
    }

    const webSubscriber = new WebSocketEventSubscriber(wss);
    logger.info('Setting up API event subscriptions...');
    webSubscriber.subscribe(activeAgent.agentEventBus);

    // Initialize webhook subscriber
    const webhookSubscriber = new WebhookEventSubscriber();
    logger.info('Setting up webhook event subscriptions...');
    webhookSubscriber.subscribe(activeAgent.agentEventBus);

    // Tool confirmation responses are handled by the main WebSocket handler below

    function ensureAgentAvailable(): void {
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

    async function switchAgentByName(name: string) {
        if (isSwitchingAgent) {
            throw AgentError.apiValidationError('Agent switch already in progress');
        }
        isSwitchingAgent = true;

        let newAgent: DextoAgent | undefined;
        try {
            // Use domain layer method to create new agent
            newAgent = await DextoAgent.createAgent(name);

            logger.info(`Starting new agent: ${name}`);
            await newAgent.start();

            // Rewire event/webhook subscribers to new agent bus
            logger.info('Rewiring event subscribers...');
            try {
                webSubscriber.unsubscribe();
            } catch (_err) {
                logger.debug('Failed to unsubscribe webSubscriber:', _err);
            }
            webSubscriber.subscribe(newAgent.agentEventBus);

            try {
                webhookSubscriber.unsubscribe();
            } catch (_err) {
                logger.debug('Failed to unsubscribe webhookSubscriber:', _err);
            }
            webhookSubscriber.subscribe(newAgent.agentEventBus);

            // Stop previous agent last (only after new one is fully operational)
            const previousAgent = activeAgent;
            activeAgent = newAgent;
            activeAgentName = name;

            logger.info(`Successfully switched to agent: ${name}`);

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

            return { name };
        } catch (error) {
            logger.error(`Failed to switch to agent ${name}:`, error);

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

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.status(200).send('OK');
    });

    app.post('/api/message', express.json(), async (req, res, next) => {
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
    });

    // Cancel an in-flight run for a session
    app.post('/api/sessions/:sessionId/cancel', async (req, res, next) => {
        try {
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
    app.post('/api/message-sync', express.json(), async (req, res, next) => {
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
    });

    app.post('/api/reset', express.json(), async (req, res, next) => {
        logger.info('Received request via POST /api/reset');
        try {
            ensureAgentAvailable();
            const { sessionId } = parseBody(
                z.object({ sessionId: z.string().optional() }),
                req.body
            );
            await activeAgent.resetConversation(sessionId);
            return res.status(200).send({ status: 'reset initiated', sessionId });
        } catch (error) {
            return next(error);
        }
    });

    // Dynamic MCP server connection endpoint (legacy)
    app.post('/api/connect-server', express.json(), async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { name, config } = parseBody(McpServerRequestSchema, req.body);
            await activeAgent.connectMcpServer(name, config);
            logger.info(`Successfully connected to new server '${name}' via API request.`);
            return res.status(200).send({ status: 'connected', name });
        } catch (error) {
            return next(error);
        }
    });

    // Add a new MCP server
    app.post('/api/mcp/servers', express.json(), async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { name, config } = parseBody(McpServerRequestSchema, req.body);
            await activeAgent.connectMcpServer(name, config);
            return res.status(201).json({ status: 'connected', name });
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
    app.get('/api/mcp/servers/:serverId/tools', async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const serverId = req.params.serverId;
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
    app.delete('/api/mcp/servers/:serverId', async (req, res, next) => {
        const { serverId } = req.params;
        logger.info(`Received request to DELETE /api/mcp/servers/${serverId}`);

        try {
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

    // Execute an MCP tool via REST wrapper
    app.post(
        '/api/mcp/servers/:serverId/tools/:toolName/execute',
        express.json(),
        async (req, res, next) => {
            const { serverId, toolName } = req.params;
            // Verify server exists
            const client = activeAgent.getMcpClients().get(serverId);
            if (!client) {
                return res
                    .status(404)
                    .json({ success: false, error: `Server '${serverId}' not found` });
            }
            try {
                // Execute tool through the agent's unified wrapper method
                const rawResult = await activeAgent.executeTool(toolName, req.body);
                // Return standardized result shape
                return res.json({ success: true, data: rawResult });
            } catch (error) {
                return next(error);
            }
        }
    );

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
                if (data.type === 'toolConfirmationResponse' && data.data) {
                    // Route confirmation back via AgentEventBus and do not broadcast an error
                    activeAgent.agentEventBus.emit('dexto:toolConfirmationResponse', data.data);
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
                    const currentConfig = activeAgent.getEffectiveConfig(sessionId);
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

                    await activeAgent.run(
                        data.content,
                        imageDataInput,
                        fileDataInput,
                        sessionId,
                        stream
                    );
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
    const agentCardData = createAgentCard(
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
    setupA2ARoutes(app, agentCardData);

    // --- Initialize and Setup MCP Server and Endpoints ---
    // Get transport type from environment variable or default to http
    try {
        const transportType = (process.env.DEXTO_MCP_TRANSPORT_TYPE as McpTransportType) || 'http';
        const mcpTransport = await createMcpTransport(transportType);

        // TODO: Think of a better way to handle the MCP implementation
        await initializeMcpServer(
            agent,
            agentCardData, // Pass the agent card data for the MCP resource
            mcpTransport
        );
        await initializeMcpServerApiEndpoints(app, mcpTransport);
    } catch (error: any) {
        logger.error(`Failed to initialize MCP server: ${error.message}`);
        // Add error middleware to handle the failure gracefully
        app.use((req, res) => {
            res.status(500).json({ error: 'MCP server initialization failed' });
        });
    }

    // ===== Agents API =====
    app.get('/api/agents', async (_req, res, next) => {
        try {
            ensureAgentAvailable();
            const agents = await activeAgent.listAgents();
            return sendJsonResponse(res, {
                installed: agents.installed,
                available: agents.available,
                current: { name: activeAgentName ?? 'default' },
            });
        } catch (error) {
            return next(error);
        }
    });

    app.get('/api/agents/current', async (_req, res, next) => {
        try {
            return sendJsonResponse(res, { name: activeAgentName ?? 'default' });
        } catch (error) {
            return next(error);
        }
    });

    const AgentNameSchema = z.object({ name: z.string().min(1) });

    app.post('/api/agents/install', express.json(), async (req, res, next) => {
        try {
            ensureAgentAvailable();
            const { name } = AgentNameSchema.parse(req.body);
            await activeAgent.installAgent(name);
            return sendJsonResponse(res, { installed: true, name }, 201);
        } catch (error) {
            return next(error);
        }
    });

    app.post('/api/agents/switch', express.json(), async (req, res, next) => {
        try {
            const { name } = AgentNameSchema.parse(req.body);
            const result = await switchAgentByName(name);
            return sendJsonResponse(res, { switched: true, ...result });
        } catch (error) {
            if (
                error instanceof Error &&
                error.message &&
                error.message.includes('already in progress')
            ) {
                return res.status(409).json({ error: error.message });
            }
            return next(error);
        }
    });

    // Configuration export endpoint
    /**
     * Helper function to redact sensitive environment variables
     */
    function redactEnvValue(value: any): any {
        if (value && typeof value === 'string' && value.length > 0) {
            return '[REDACTED]';
        }
        return value;
    }

    /**
     * Helper function to redact environment variables in a server config
     */
    function redactServerEnvVars(serverConfig: any): any {
        if (!serverConfig.env) {
            return serverConfig;
        }

        const redactedEnv: Record<string, any> = {};
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
    function redactMcpServersConfig(mcpServers: any): Record<string, any> {
        if (!mcpServers) {
            return {};
        }

        const redactedServers: Record<string, any> = {};
        for (const [name, serverConfig] of Object.entries(mcpServers)) {
            redactedServers[name] = redactServerEnvVars(serverConfig);
        }

        return redactedServers;
    }

    app.get('/api/config.yaml', async (req, res, next) => {
        try {
            const sessionId = req.query.sessionId as string | undefined;
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

    // Get default greeting (for UI consumption)
    app.get('/api/greeting', async (req, res, next) => {
        try {
            const sessionId = req.query.sessionId as string | undefined;
            const config = activeAgent.getEffectiveConfig(sessionId);
            res.json({ greeting: config.greeting });
        } catch (error) {
            return next(error);
        }
    });

    // Get current LLM configuration
    app.get('/api/llm/current', async (req, res, next) => {
        try {
            const { sessionId } = req.query;

            // Use session-specific config if sessionId is provided, otherwise use default
            const currentConfig = sessionId
                ? activeAgent.getEffectiveConfig(sessionId as string).llm
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

    // (Deprecated) /api/llm/providers has been replaced by /api/llm/catalog

    // LLM Catalog: providers, models, and API key presence (with filters)
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

            // Parse query parameters with Zod
            const QuerySchema = z.object({
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
                mode: z.enum(['grouped', 'flat']).optional().default('grouped'),
            });

            const queryParams: z.output<typeof QuerySchema> = QuerySchema.parse(req.query);

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
    app.post('/api/llm/key', express.json({ limit: '4kb' }), async (req, res, next) => {
        try {
            const schema = z.object({
                provider: z.enum(LLM_PROVIDERS),
                apiKey: z.string().min(1, 'API key is required'),
            });
            const body = schema.parse(req.body);

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
    app.post('/api/llm/switch', express.json(), async (req, res, next) => {
        try {
            const body = (req.body ?? {}) as Record<string, unknown>;
            const sessionId =
                typeof body.sessionId === 'string' ? (body.sessionId as string) : undefined;
            const { sessionId: _omit, ...llmCandidate } = body;
            const llmConfig = LLMUpdatesSchema.parse(llmCandidate);
            const config = await activeAgent.switchLLM(llmConfig, sessionId);
            return res.status(200).json({ config, sessionId });
        } catch (error) {
            return next(error);
        }
    });

    // Session Management APIs

    // List all active sessions
    app.get('/api/sessions', async (req, res, next) => {
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
                        };
                    } catch (_error) {
                        // Skip sessions that no longer exist
                        return {
                            id,
                            createdAt: null,
                            lastActivity: null,
                            messageCount: 0,
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
    app.post('/api/sessions', express.json(), async (req, res, next) => {
        try {
            const { sessionId } = req.body;
            const session = await activeAgent.createSession(sessionId);
            const metadata = await activeAgent.getSessionMetadata(session.id);
            return res.status(201).json({
                session: {
                    id: session.id,
                    createdAt: metadata?.createdAt || Date.now(),
                    lastActivity: metadata?.lastActivity || Date.now(),
                    messageCount: metadata?.messageCount || 0,
                },
            });
        } catch (error) {
            return next(error);
        }
    });

    // Get current working session (must come before parameterized route)
    app.get('/api/sessions/current', async (req, res, next) => {
        try {
            const currentSessionId = activeAgent.getCurrentSessionId();
            return res.json({ currentSessionId });
        } catch (error) {
            return next(error);
        }
    });

    // Get session details
    app.get('/api/sessions/:sessionId', async (req, res, next) => {
        try {
            const { sessionId } = req.params;
            const metadata = await activeAgent.getSessionMetadata(sessionId);
            const history = await activeAgent.getSessionHistory(sessionId);

            return res.json({
                session: {
                    id: sessionId,
                    createdAt: metadata?.createdAt || null,
                    lastActivity: metadata?.lastActivity || null,
                    messageCount: metadata?.messageCount || 0,
                    history: history.length,
                },
            });
        } catch (error) {
            return next(error);
        }
    });

    // Get session conversation history
    app.get('/api/sessions/:sessionId/history', async (req, res, next) => {
        try {
            const { sessionId } = req.params;
            // getSessionHistory already checks existence via getSession
            const history = await activeAgent.getSessionHistory(sessionId);
            return res.json({ history });
        } catch (error) {
            return next(error);
        }
    });

    // Search messages across all sessions or within a specific session
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
    app.get('/api/search/sessions', async (req, res, next) => {
        try {
            const { q: query } = parseQuery(
                z.object({ q: z.string().min(1, 'Search query is required') }),
                req.query
            );
            const searchResults = await activeAgent.searchSessions(query);
            return sendJsonResponse(res, searchResults);
        } catch (error) {
            return next(error);
        }
    });

    // Delete a session
    app.delete('/api/sessions/:sessionId', async (req, res, next) => {
        try {
            const { sessionId } = req.params;
            // deleteSession already checks existence internally
            await activeAgent.deleteSession(sessionId);
            return res.json({ status: 'deleted', sessionId });
        } catch (error) {
            return next(error);
        }
    });

    // Load session as current working session and set as default
    app.post('/api/sessions/:sessionId/load', async (req, res, next) => {
        try {
            const { sessionId } = req.params;

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
    app.get('/api/webhooks', async (req, res, next) => {
        try {
            const webhooks = webhookSubscriber.getWebhooks().map((webhook) => ({
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
    app.get('/api/webhooks/:webhookId', async (req, res, next) => {
        try {
            const { webhookId } = req.params;
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
    app.delete('/api/webhooks/:webhookId', async (req, res, next) => {
        try {
            const { webhookId } = req.params;
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
    app.post('/api/webhooks/:webhookId/test', async (req, res, next) => {
        try {
            const { webhookId } = req.params;
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
    agentName?: string
) {
    const { server, wss, webSubscriber, webhookSubscriber } = await initializeApi(
        agent,
        agentCardOverride,
        port,
        agentName
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
