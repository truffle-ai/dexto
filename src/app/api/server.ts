import express from 'express';
import type { Express } from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { WebSocketEventSubscriber } from './websocket-subscriber.js';
import { WebhookEventSubscriber } from './webhook-subscriber.js';
import type { WebhookConfig } from './webhook-types.js';
import { logger } from '@core/index.js';
import { redactSensitiveData } from '@core/utils/redactor.js';
import type { AgentCard } from '@core/index.js';
import { setupA2ARoutes } from './a2a.js';
import {
    createMcpTransport,
    initializeMcpServer,
    initializeMcpServerApiEndpoints,
    type McpTransportType,
} from './mcp/mcp_handler.js';
import { createAgentCard } from '@core/index.js';
import { DextoAgent } from '@core/index.js';
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
import { errorHandler } from './middleware/errorHandler.js';
import { McpServerConfigSchema } from '@core/mcp/schemas.js';
import { sendWebSocketError, sendWebSocketValidationError } from './websocket-error-handler.js';
import { DextoValidationError } from '@core/errors/DextoValidationError.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { AgentErrorCode } from '@core/agent/error-codes.js';

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

    app.post('/api/message', express.json(), async (req, res, next) => {
        logger.info('Received message via POST /api/message');
        try {
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

            const response = await agent.run(
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
            const cancelled = await agent.cancel(sessionId);
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

            const response = await agent.run(
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
            const { sessionId } = parseBody(
                z.object({ sessionId: z.string().optional() }),
                req.body
            );
            await agent.resetConversation(sessionId);
            return res.status(200).send({ status: 'reset initiated', sessionId });
        } catch (error) {
            return next(error);
        }
    });

    // Dynamic MCP server connection endpoint (legacy)
    app.post('/api/connect-server', express.json(), async (req, res, next) => {
        try {
            const { name, config } = parseBody(McpServerRequestSchema, req.body);
            await agent.connectMcpServer(name, config);
            logger.info(`Successfully connected to new server '${name}' via API request.`);
            return res.status(200).send({ status: 'connected', name });
        } catch (error) {
            return next(error);
        }
    });

    // Add a new MCP server
    app.post('/api/mcp/servers', express.json(), async (req, res, next) => {
        try {
            const { name, config } = parseBody(McpServerRequestSchema, req.body);
            await agent.connectMcpServer(name, config);
            return res.status(201).json({ status: 'connected', name });
        } catch (error) {
            return next(error);
        }
    });

    // Add MCP servers listing endpoint
    app.get('/api/mcp/servers', async (req, res, next) => {
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
            return next(error);
        }
    });

    // Add MCP server tools listing endpoint
    app.get('/api/mcp/servers/:serverId/tools', async (req, res, next) => {
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
                agent.getMcpClients().has(serverId) || agent.getMcpFailedConnections()[serverId];
            if (!clientExists) {
                logger.warn(`Attempted to delete non-existent server: ${serverId}`);
                return res.status(404).json({ error: `Server '${serverId}' not found.` });
            }

            await agent.removeMcpServer(serverId);
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
                    agent.agentEventBus.emit('dexto:toolConfirmationResponse', data.data);
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
                        sendWebSocketError(ws, hierarchicalError);
                        return;
                    }

                    await agent.run(data.content, imageDataInput, fileDataInput, sessionId, stream);
                } else if (data.type === 'reset') {
                    const sessionId = data.sessionId as string | undefined;
                    logger.info(
                        `Processing reset command from WebSocket${sessionId ? ` for session: ${sessionId}` : ''}.`
                    );
                    await agent.resetConversation(sessionId);
                } else if (data.type === 'cancel') {
                    const sessionId = data.sessionId as string | undefined;
                    logger.info(
                        `Processing cancel command from WebSocket${sessionId ? ` for session: ${sessionId}` : ''}.`
                    );
                    const cancelled = await agent.cancel(sessionId);
                    if (!cancelled) {
                        logger.debug('No in-flight run to cancel');
                    }
                } else {
                    logger.warn(`Received unknown WebSocket message type: ${data.type}`);
                    sendWebSocketValidationError(ws, 'Unknown message type', {
                        messageType: data.type,
                    });
                }
            } catch (error) {
                logger.error(
                    `Error processing WebSocket message: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
                sendWebSocketError(ws, error);
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

    app.get('/api/config.yaml', async (req, res, next) => {
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
                ? agent.getEffectiveConfig(sessionId as string).llm
                : agent.getCurrentLLMConfig();

            res.json({ config: currentConfig });
        } catch (error) {
            return next(error);
        }
    });

    // Get available LLM providers and models
    app.get('/api/llm/providers', async (req, res, next) => {
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
            const config = await agent.switchLLM(llmConfig, sessionId);
            return res.status(200).json({ config, sessionId });
        } catch (error) {
            return next(error);
        }
    });

    // Session Management APIs

    // List all active sessions
    app.get('/api/sessions', async (req, res, next) => {
        try {
            const sessionIds = await agent.listSessions();
            const sessions = await Promise.all(
                sessionIds.map(async (id) => {
                    try {
                        const metadata = await agent.getSessionMetadata(id);
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
            const session = await agent.createSession(sessionId);
            const metadata = await agent.getSessionMetadata(session.id);
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
            const currentSessionId = agent.getCurrentSessionId();
            return res.json({ currentSessionId });
        } catch (error) {
            return next(error);
        }
    });

    // Get session details
    app.get('/api/sessions/:sessionId', async (req, res, next) => {
        try {
            const { sessionId } = req.params;
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
            return next(error);
        }
    });

    // Get session conversation history
    app.get('/api/sessions/:sessionId/history', async (req, res, next) => {
        try {
            const { sessionId } = req.params;
            // getSessionHistory already checks existence via getSession
            const history = await agent.getSessionHistory(sessionId);
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

            const searchResults = await agent.searchMessages(query, options);
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
            const searchResults = await agent.searchSessions(query);
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
            await agent.deleteSession(sessionId);
            return res.json({ status: 'deleted', sessionId });
        } catch (error) {
            return next(error);
        }
    });

    // Load session as current working session
    app.post('/api/sessions/:sessionId/load', async (req, res, next) => {
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

            // loadSession already checks session existence
            await agent.loadSession(sessionId);
            return res.json({
                status: 'loaded',
                sessionId,
                currentSession: agent.getCurrentSessionId(),
            });
        } catch (error) {
            return next(error);
        }
    });

    // Webhook Management APIs

    // Initialize webhook subscriber
    const webhookSubscriber = new WebhookEventSubscriber();
    logger.info('Setting up webhook event subscriptions...');
    webhookSubscriber.subscribe(agent.agentEventBus);

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
