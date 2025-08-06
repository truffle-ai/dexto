import express from 'express';
import type { Express } from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { WebSocketEventSubscriber } from './websocket-subscriber.js';
import { WebhookEventSubscriber } from './webhook-subscriber.js';
import type { WebhookRegistrationRequest, WebhookConfig } from './webhook-types.js';
import { logger } from '@core/index.js';
import type { AgentCard } from '@core/index.js';
import { setupA2ARoutes } from './a2a.js';
import {
    createMcpTransport,
    initializeMcpServer,
    initializeMcpServerApiEndpoints,
    type McpTransportType,
} from './mcp/mcp_handler.js';
import { createAgentCard } from '@core/index.js';
import { DextoAgent, DextoError } from '@core/index.js';
import { stringify as yamlStringify } from 'yaml';
import os from 'os';
import { resolveBundledScript } from '@core/index.js';
import { expressRedactionMiddleware } from './middleware/expressRedactionMiddleware.js';
import { z } from 'zod';
import { LLMUpdatesSchema } from '@core/llm/schemas.js';
import { registerGracefulShutdown } from '../utils/graceful-shutdown.js';
import { validateInputForLLM } from '@core/llm/validation.js';
import {
    LLM_REGISTRY,
    LLM_PROVIDERS,
    getSupportedRoutersForProvider,
    supportsBaseURL,
} from '@core/llm/registry.js';

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

/**
 * Schema for LLM switch API requests
 */
const LLMSwitchRequestSchema = z
    .object({
        sessionId: z.string().optional(),
    })
    .merge(LLMUpdatesSchema);

/**
 * Helper function to validate request body and handle validation errors
 */
function validateBody<T>(
    schema: z.ZodType<T>,
    body: unknown
): { success: true; data: T } | { success: false; response: any } {
    const result = schema.safeParse(body);

    if (!result.success) {
        return {
            success: false,
            response: {
                ok: false,
                issues: result.error.errors.map((err) => ({
                    code: 'schema_validation',
                    message: err.message,
                    path: err.path,
                    severity: 'error',
                    context: { field: err.path.join('.') },
                })),
            },
        };
    }

    return { success: true, data: result.data };
}

// TODO: API endpoint names are work in progress and might be refactored/renamed in future versions
export async function initializeApi(agent: DextoAgent, agentCardOverride?: Partial<AgentCard>) {
    const app = express();
    registerGracefulShutdown(agent);
    // this will apply middleware to all /api/llm/* routes
    app.use('/api/llm', expressRedactionMiddleware);
    app.use('/api/config.yaml', expressRedactionMiddleware);

    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    // set up event broadcasting over WebSocket
    const webSubscriber = new WebSocketEventSubscriber(wss);
    logger.info('Setting up API event subscriptions...');
    webSubscriber.subscribe(agent.agentEventBus);

    // Tool confirmation responses are handled by the main WebSocket handler below

    // HTTP endpoints

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.status(200).send('OK');
    });

    app.post('/api/message', express.json(), async (req, res) => {
        logger.info('Received message via POST /api/message');
        if (!req.body || !req.body.message) {
            return res.status(400).send({ error: 'Missing message content' });
        }
        try {
            const sessionId = req.body.sessionId as string | undefined;
            const stream = req.body.stream === true; // Extract stream preference, default to false
            const imageDataInput = req.body.imageData
                ? { image: req.body.imageData.base64, mimeType: req.body.imageData.mimeType }
                : undefined;

            // Process file data
            const fileDataInput = req.body.fileData
                ? {
                      data: req.body.fileData.base64,
                      mimeType: req.body.fileData.mimeType,
                      filename: req.body.fileData.filename,
                  }
                : undefined;

            if (imageDataInput) logger.info('Image data included in message.');
            if (fileDataInput) logger.info('File data included in message.');
            if (sessionId) logger.info(`Message for session: ${sessionId}`);

            // Comprehensive input validation
            const currentConfig = agent.getEffectiveConfig(sessionId);
            const validation = validateInputForLLM(
                {
                    text: req.body.message,
                    ...(imageDataInput && { imageData: imageDataInput }),
                    ...(fileDataInput && { fileData: fileDataInput }),
                },
                {
                    provider: currentConfig.llm.provider,
                    model: currentConfig.llm.model,
                }
            );

            if (!validation.ok) {
                const errorMessages = validation.issues
                    .filter((issue) => issue.severity === 'error')
                    .map((issue) => issue.message);

                return res.status(400).send({
                    error: errorMessages.join('; '),
                    provider: currentConfig.llm.provider,
                    model: currentConfig.llm.model,
                    issues: validation.issues,
                });
            }

            await agent.run(req.body.message, imageDataInput, fileDataInput, sessionId, stream);
            return res.status(202).send({ status: 'processing', sessionId });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error handling POST /api/message: ${errorMessage}`);
            return res.status(500).send({ error: 'Internal server error' });
        }
    });

    // Synchronous endpoint: await the full AI response and return it in one go
    app.post('/api/message-sync', express.json(), async (req, res) => {
        logger.info('Received message via POST /api/message-sync');
        if (!req.body || !req.body.message) {
            return res.status(400).send({ error: 'Missing message content' });
        }
        try {
            // Extract optional image and file data
            const imageDataInput = req.body.imageData
                ? { image: req.body.imageData.base64, mimeType: req.body.imageData.mimeType }
                : undefined;

            // Process file data
            const fileDataInput = req.body.fileData
                ? {
                      data: req.body.fileData.base64,
                      mimeType: req.body.fileData.mimeType,
                      filename: req.body.fileData.filename,
                  }
                : undefined;

            const sessionId = req.body.sessionId as string | undefined;
            const stream = req.body.stream === true; // Extract stream preference, default to false
            if (imageDataInput) logger.info('Image data included in message.');
            if (fileDataInput) logger.info('File data included in message.');
            if (sessionId) logger.info(`Message for session: ${sessionId}`);

            // Comprehensive input validation
            const currentConfig = agent.getEffectiveConfig(sessionId);
            const validation = validateInputForLLM(
                {
                    text: req.body.message,
                    ...(imageDataInput && { imageData: imageDataInput }),
                    ...(fileDataInput && { fileData: fileDataInput }),
                },
                {
                    provider: currentConfig.llm.provider,
                    model: currentConfig.llm.model,
                }
            );

            if (!validation.ok) {
                const errorMessages = validation.issues
                    .filter((issue) => issue.severity === 'error')
                    .map((issue) => issue.message);

                return res.status(400).send({
                    error: errorMessages.join('; '),
                    provider: currentConfig.llm.provider,
                    model: currentConfig.llm.model,
                    issues: validation.issues,
                });
            }

            await agent.run(req.body.message, imageDataInput, fileDataInput, sessionId, stream);
            return res.status(202).send({ status: 'processing', sessionId });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error handling POST /api/message-sync: ${errorMessage}`);
            return res.status(500).send({ error: 'Internal server error' });
        }
    });

    app.post('/api/reset', express.json(), async (req, res) => {
        logger.info('Received request via POST /api/reset');
        try {
            const sessionId = req.body.sessionId as string | undefined;
            await agent.resetConversation(sessionId);
            return res.status(200).send({ status: 'reset initiated', sessionId });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error handling POST /api/reset: ${errorMessage}`);
            return res.status(500).send({ error: 'Internal server error' });
        }
    });

    // Dynamic MCP server connection endpoint (legacy)
    app.post('/api/connect-server', express.json(), async (req, res) => {
        const { name, config } = req.body;
        if (!name || typeof name !== 'string' || name.trim() === '') {
            return res.status(400).send({ error: 'Missing or invalid server name' });
        }
        if (!config || typeof config !== 'object') {
            return res.status(400).send({ error: 'Missing or invalid server config object' });
        }
        try {
            await agent.connectMcpServer(name, config);
            logger.info(`Successfully connected to new server '${name}' via API request.`);
            return res.status(200).send({ status: 'connected', name });
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : 'Unknown error during connection';
            logger.error(`Error handling POST /api/connect-server for '${name}': ${errorMessage}`);
            return res.status(500).send({
                error: `Failed to connect to server '${name}': ${errorMessage}`,
            });
        }
    });

    // Add a new MCP server
    app.post('/api/mcp/servers', express.json(), async (req, res) => {
        const { name, config } = req.body;
        if (!name || !config) {
            return res.status(400).json({ error: 'Missing name or config' });
        }
        try {
            await agent.connectMcpServer(name, config);
            return res.status(201).json({ status: 'connected', name });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error connecting MCP server '${name}': ${errorMessage}`);
            return res.status(500).json({ error: `Failed to connect server: ${errorMessage}` });
        }
    });

    // Add MCP servers listing endpoint
    app.get('/api/mcp/servers', async (req, res) => {
        try {
            const clientsMap = agent.getMcpClients();
            const failedConnections = agent.getMcpFailedConnections();
            const servers: Array<{ id: string; name: string; status: string }> = [];
            for (const name of clientsMap.keys()) {
                servers.push({ id: name, name, status: 'connected' });
            }
            for (const name of Object.keys(failedConnections)) {
                servers.push({ id: name, name, status: 'error' });
            }
            return res.status(200).json({ servers });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error listing MCP servers: ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to list servers' });
        }
    });

    // Add MCP server tools listing endpoint
    app.get('/api/mcp/servers/:serverId/tools', async (req, res) => {
        const serverId = req.params.serverId;
        const client = agent.getMcpClients().get(serverId);
        if (!client) {
            return res.status(404).json({ error: `Server '${serverId}' not found` });
        }
        try {
            const toolsMap = await client.getTools();
            const tools = Object.entries(toolsMap).map(([toolName, toolDef]) => ({
                id: toolName,
                name: toolName,
                description: toolDef.description || '',
                inputSchema: toolDef.parameters,
            }));
            return res.status(200).json({ tools });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error fetching tools for server '${serverId}': ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to fetch tools for server' });
        }
    });

    // Endpoint to remove/disconnect an MCP server
    app.delete('/api/mcp/servers/:serverId', async (req, res) => {
        const { serverId } = req.params;
        logger.info(`Received request to DELETE /api/mcp/servers/${serverId}`);

        try {
            // Check if server exists before attempting to disconnect
            const clientExists =
                agent.getMcpClients().has(serverId) || agent.getMcpFailedConnections()[serverId];
            if (!clientExists) {
                logger.warn(`Attempted to delete non-existent server: ${serverId}`);
                return res.status(404).json({ error: `Server '${serverId}' not found.` });
            }

            await agent.removeMcpServer(serverId);
            return res.status(200).json({ status: 'disconnected', id: serverId });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error deleting server '${serverId}': ${errorMessage}`);
            return res.status(500).json({
                error: `Failed to delete server '${serverId}': ${errorMessage}`,
            });
        }
    });

    // Execute an MCP tool via REST wrapper
    app.post(
        '/api/mcp/servers/:serverId/tools/:toolName/execute',
        express.json(),
        async (req, res) => {
            const { serverId, toolName } = req.params;
            // Verify server exists
            const client = agent.getMcpClients().get(serverId);
            if (!client) {
                return res
                    .status(404)
                    .json({ success: false, error: `Server '${serverId}' not found` });
            }
            try {
                // Execute tool through the agent's unified wrapper method
                const rawResult = await agent.executeTool(toolName, req.body);
                // Return standardized result shape
                return res.json({ success: true, data: rawResult });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger.error(
                    `Error executing tool '${toolName}' on server '${serverId}': ${errorMessage}`
                );
                return res.status(500).json({ success: false, error: errorMessage });
            }
        }
    );

    // WebSocket handling
    // handle inbound client messages over WebSocket
    wss.on('connection', (ws: WebSocket) => {
        logger.info('WebSocket client connected.');

        ws.on('message', async (messageBuffer) => {
            const messageString = messageBuffer.toString();
            logger.debug(`WebSocket received message: ${messageString}`);
            try {
                const data = JSON.parse(messageString);
                if (data.type === 'toolConfirmationResponse' && data.data) {
                    // Route confirmation back via AgentEventBus and do not broadcast an error
                    agent.agentEventBus.emit('dexto:toolConfirmationResponse', data.data);
                    return;
                } else if (
                    data.type === 'message' &&
                    (data.content || data.imageData || data.fileData)
                ) {
                    logger.info(
                        `Processing message from WebSocket: ${data.content.substring(0, 50)}...`
                    );
                    const imageDataInput = data.imageData
                        ? { image: data.imageData.base64, mimeType: data.imageData.mimeType }
                        : undefined;

                    // Process file data
                    const fileDataInput = data.fileData
                        ? {
                              data: data.fileData.base64,
                              mimeType: data.fileData.mimeType,
                              filename: data.fileData.filename,
                          }
                        : undefined;

                    const sessionId = data.sessionId as string | undefined;
                    const stream = data.stream === true; // Extract stream preference, default to false
                    if (imageDataInput) logger.info('Image data included in message.');
                    if (fileDataInput) logger.info('File data included in message.');
                    if (sessionId) logger.info(`Message for session: ${sessionId}`);

                    // Comprehensive input validation
                    const currentConfig = agent.getEffectiveConfig(sessionId);
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
                        const errorMessages = validation.issues
                            .filter((issue) => issue.severity === 'error')
                            .map((issue) => issue.message);

                        const errorDetails = {
                            error: errorMessages.join('; '),
                            provider: currentConfig.llm.provider,
                            model: currentConfig.llm.model,
                            issues: validation.issues,
                        };

                        ws.send(
                            JSON.stringify({
                                event: 'error',
                                data: errorDetails,
                            })
                        );
                        return;
                    }

                    await agent.run(data.content, imageDataInput, fileDataInput, sessionId, stream);
                } else if (data.type === 'reset') {
                    const sessionId = data.sessionId as string | undefined;
                    logger.info(
                        `Processing reset command from WebSocket${sessionId ? ` for session: ${sessionId}` : ''}.`
                    );
                    await agent.resetConversation(sessionId);
                } else {
                    logger.warn(`Received unknown WebSocket message type: ${data.type}`);
                    ws.send(
                        JSON.stringify({
                            event: 'error',
                            data: { message: 'Unknown message type' },
                        })
                    );
                }
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                logger.error(`Error processing WebSocket message: ${errorMessage}`);
                ws.send(
                    JSON.stringify({
                        event: 'error',
                        data: { message: 'Failed to process message' },
                    })
                );
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
    const baseApiUrl = process.env.DEXTO_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
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

    app.get('/api/config.yaml', async (req, res) => {
        try {
            const sessionId = req.query.sessionId as string | undefined;
            const config = agent.getEffectiveConfig(sessionId);

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
        } catch (error: any) {
            logger.error(`Error exporting config: ${error.message}`);
            res.status(500).json({ error: 'Failed to export configuration' });
        }
    });

    // Get current LLM configuration
    app.get('/api/llm/current', async (req, res) => {
        try {
            const { sessionId } = req.query;

            // Use session-specific config if sessionId is provided, otherwise use default
            const currentConfig = sessionId
                ? agent.getEffectiveConfig(sessionId as string).llm
                : agent.getCurrentLLMConfig();

            res.json({ config: currentConfig });
        } catch (error: any) {
            logger.error(`Error getting current LLM config: ${error.message}`);
            res.status(500).json({ error: 'Failed to get current LLM configuration' });
        }
    });

    // Get available LLM providers and models
    app.get('/api/llm/providers', async (req, res) => {
        try {
            // Build providers object from the LLM registry
            const providers: Record<
                string,
                {
                    name: string;
                    models: string[];
                    supportedRouters: string[];
                    supportsBaseURL: boolean;
                }
            > = {};

            for (const provider of LLM_PROVIDERS) {
                const providerInfo = LLM_REGISTRY[provider];
                // Convert provider key to display name
                const displayName = provider.charAt(0).toUpperCase() + provider.slice(1);

                providers[provider] = {
                    name: displayName,
                    models: providerInfo.models.map((model) => model.name),
                    supportedRouters: getSupportedRoutersForProvider(provider),
                    supportsBaseURL: supportsBaseURL(provider),
                };
            }

            res.json({ providers });
        } catch (error: any) {
            logger.error(`Error getting LLM providers: ${error.message}`);
            res.status(500).json({ error: 'Failed to get LLM providers' });
        }
    });

    // Switch LLM configuration
    app.post('/api/llm/switch', express.json(), async (req, res) => {
        // Validate request body
        const validation = validateBody(LLMSwitchRequestSchema, req.body);
        if (!validation.success) {
            return res.status(400).json(validation.response);
        }

        const { sessionId, ...llmConfig } = validation.data;

        try {
            const config = await agent.switchLLM(llmConfig, sessionId);

            return res.status(200).json({
                ok: true,
                data: config,
                issues: [],
            });
            // TODO: move this check to middleware
        } catch (error) {
            if (error instanceof DextoError) {
                // Use error middleware for consistent handling
                throw error;
            } else {
                // Infrastructure errors -> 500
                logger.error('LLM switch failed:', error);
                return res.status(500).json({
                    ok: false,
                    issues: [
                        {
                            code: 'internal_server_error',
                            message: 'Internal server error during LLM switch',
                            severity: 'error',
                            context: {},
                        },
                    ],
                });
            }
        }
    });

    // Session Management APIs

    // List all active sessions
    app.get('/api/sessions', async (req, res) => {
        try {
            const sessionIds = await agent.listSessions();
            const sessions = await Promise.all(
                sessionIds.map(async (id) => {
                    const metadata = await agent.getSessionMetadata(id);
                    return {
                        id,
                        createdAt: metadata?.createdAt || null,
                        lastActivity: metadata?.lastActivity || null,
                        messageCount: metadata?.messageCount || 0,
                    };
                })
            );
            return res.json({ sessions });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error listing sessions: ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to list sessions' });
        }
    });

    // Create a new session
    app.post('/api/sessions', express.json(), async (req, res) => {
        try {
            const { sessionId } = req.body;
            const session = await agent.createSession(sessionId);
            const metadata = await agent.getSessionMetadata(session.id);
            return res.status(201).json({
                session: {
                    id: session.id,
                    createdAt: metadata?.createdAt || null,
                    lastActivity: metadata?.lastActivity || null,
                    messageCount: metadata?.messageCount || 0,
                },
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error creating session: ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to create session' });
        }
    });

    // Get session details
    app.get('/api/sessions/:sessionId', async (req, res) => {
        try {
            const { sessionId } = req.params;
            const session = await agent.getSession(sessionId);
            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }

            const metadata = await agent.getSessionMetadata(sessionId);
            const history = await agent.getSessionHistory(sessionId);

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
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error getting session ${req.params.sessionId}: ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to get session details' });
        }
    });

    // Get session conversation history
    app.get('/api/sessions/:sessionId/history', async (req, res) => {
        try {
            const { sessionId } = req.params;
            const session = await agent.getSession(sessionId);
            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }

            const history = await agent.getSessionHistory(sessionId);
            return res.json({ history });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(
                `Error getting session history for ${req.params.sessionId}: ${errorMessage}`
            );
            return res.status(500).json({ error: 'Failed to get session history' });
        }
    });

    // Search messages across all sessions or within a specific session
    app.get('/api/search/messages', async (req, res) => {
        try {
            const query = req.query.q as string;
            if (!query) {
                return res.status(400).json({ error: 'Search query is required' });
            }

            const options: {
                limit: number;
                offset: number;
                sessionId?: string;
                role?: 'user' | 'assistant' | 'system' | 'tool';
            } = {
                limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
                offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
            };

            const sessionId = req.query.sessionId as string | undefined;
            const role = req.query.role as 'user' | 'assistant' | 'system' | 'tool' | undefined;

            if (sessionId) {
                options.sessionId = sessionId;
            }
            if (role) {
                options.role = role;
            }

            const searchResults = await agent.searchMessages(query, options);
            return sendJsonResponse(res, searchResults);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error searching messages: ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to search messages' });
        }
    });

    // Search sessions that contain the query
    app.get('/api/search/sessions', async (req, res) => {
        try {
            const query = req.query.q as string;
            if (!query) {
                return res.status(400).json({ error: 'Search query is required' });
            }

            const searchResults = await agent.searchSessions(query);
            return sendJsonResponse(res, searchResults);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error searching sessions: ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to search sessions' });
        }
    });

    // Delete a session
    app.delete('/api/sessions/:sessionId', async (req, res) => {
        try {
            const { sessionId } = req.params;
            const session = await agent.getSession(sessionId);
            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }

            await agent.deleteSession(sessionId);
            return res.json({ status: 'deleted', sessionId });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error deleting session ${req.params.sessionId}: ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to delete session' });
        }
    });

    // Load session as current working session
    app.post('/api/sessions/:sessionId/load', async (req, res) => {
        try {
            const { sessionId } = req.params;

            // Handle null/reset case
            if (sessionId === 'null' || sessionId === 'undefined') {
                await agent.loadSession(null);
                res.json({
                    status: 'reset',
                    sessionId: null,
                    currentSession: agent.getCurrentSessionId(),
                });
                return;
            }

            const session = await agent.getSession(sessionId);
            if (!session) {
                return res.status(404).json({ error: 'Session not found' });
            }

            await agent.loadSession(sessionId);
            return res.json({
                status: 'loaded',
                sessionId,
                currentSession: agent.getCurrentSessionId(),
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error loading session ${req.params.sessionId}: ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to load session' });
        }
    });

    // Get current working session
    app.get('/api/sessions/current', async (req, res) => {
        try {
            const currentSessionId = agent.getCurrentSessionId();
            return res.json({ currentSessionId });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error getting current session: ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to get current session' });
        }
    });

    // Webhook Management APIs

    // Initialize webhook subscriber
    const webhookSubscriber = new WebhookEventSubscriber();
    logger.info('Setting up webhook event subscriptions...');
    webhookSubscriber.subscribe(agent.agentEventBus);

    // Register a new webhook endpoint
    app.post('/api/webhooks', express.json(), async (req, res) => {
        try {
            const { url, secret, description }: WebhookRegistrationRequest = req.body;

            if (!url || typeof url !== 'string') {
                return res.status(400).json({ error: 'Invalid or missing webhook URL' });
            }

            // Validate URL format
            try {
                new URL(url);
            } catch {
                return res.status(400).json({ error: 'Invalid URL format' });
            }

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
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error registering webhook: ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to register webhook' });
        }
    });

    // List all registered webhooks
    app.get('/api/webhooks', async (req, res) => {
        try {
            const webhooks = webhookSubscriber.getWebhooks().map((webhook) => ({
                id: webhook.id,
                url: webhook.url,
                description: webhook.description,
                createdAt: webhook.createdAt,
            }));

            return sendJsonResponse(res, { webhooks });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error listing webhooks: ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to list webhooks' });
        }
    });

    // Get a specific webhook
    app.get('/api/webhooks/:webhookId', async (req, res) => {
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
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error getting webhook ${req.params.webhookId}: ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to get webhook' });
        }
    });

    // Remove a webhook endpoint
    app.delete('/api/webhooks/:webhookId', async (req, res) => {
        try {
            const { webhookId } = req.params;
            const removed = webhookSubscriber.removeWebhook(webhookId);

            if (!removed) {
                return res.status(404).json({ error: 'Webhook not found' });
            }

            logger.info(`Webhook removed: ${webhookId}`);
            return res.json({ status: 'removed', webhookId });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error removing webhook ${req.params.webhookId}: ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to remove webhook' });
        }
    });

    // Test a webhook endpoint
    app.post('/api/webhooks/:webhookId/test', async (req, res) => {
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
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`Error testing webhook ${req.params.webhookId}: ${errorMessage}`);
            return res.status(500).json({ error: 'Failed to test webhook' });
        }
    });

    return { app, server, wss, webSubscriber, webhookSubscriber };
}

/** Serves the legacy web UI on the express app. will be deprecated soon */
export function startLegacyWebUI(app: Express) {
    const publicPath = resolveBundledScript('public');
    logger.info(`Serving static files from: ${publicPath}`);
    app.use(express.static(publicPath));
}

// TODO: Refactor this when we get rid of the legacy web UI
export async function startApiAndLegacyWebUIServer(
    agent: DextoAgent,
    port = 3000,
    serveLegacyWebUI?: boolean,
    agentCardOverride?: Partial<AgentCard>
) {
    const { app, server, wss, webSubscriber, webhookSubscriber } = await initializeApi(
        agent,
        agentCardOverride
    );

    // Serve legacy static UI from public/, for backward compatibility
    if (serveLegacyWebUI) {
        startLegacyWebUI(app);
    }

    // Next.js front-end handles static assets; only mount API and WebSocket routes here.
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

        if (serveLegacyWebUI) {
            logger.info(
                `API server & Legacy WebUI started successfully. Accessible at: http://localhost:${port} and http://${localIp}:${port} on your local network.`,
                null,
                'green'
            );
            logger.warn(
                `Legacy WebUI at http://localhost:${port} will be deprecated in a future release. Use the new Next.js WebUI for a better experience.`,
                null,
                'yellow'
            );
        } else {
            logger.info(
                `API server started successfully. Accessible at: http://localhost:${port} and http://${localIp}:${port} on your local network.`,
                null,
                'green'
            );
        }
    });

    return { server, wss, webSubscriber, webhookSubscriber };
}
