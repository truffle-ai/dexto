import { z } from 'zod';
import { HttpClient } from './http-client.js';
import { WebSocketClient, EventHandler } from './websocket-client.js';
import {
    ClientConfig,
    ClientOptions,
    MessageInput,
    MessageResponse,
    SessionInfo,
    LLMConfig,
    McpServer,
    Tool,
    SearchOptions,
    SearchResponse,
    SessionSearchResponse,
    DextoClientError,
    CatalogOptions,
    CatalogResponse,
} from './types.js';
import {
    ClientConfigSchema,
    ClientOptionsSchema,
    MessageInputSchema,
    MessageResponseSchema,
    LLMConfigInputSchema,
    SearchOptionsSchema,
    SearchResponseSchema,
    SessionSearchResponseSchema,
    CatalogOptionsSchema,
    CatalogResponseSchema,
    SessionsListResponseSchema,
    SessionCreateResponseSchema,
    SessionGetResponseSchema,
    SessionHistoryResponseSchema,
    CurrentSessionResponseSchema,
    LLMCurrentResponseSchema,
    LLMSwitchResponseSchema,
    LLMProvidersResponseSchema,
    MCPServersResponseSchema,
    MCPServerToolsResponseSchema,
    MCPToolExecuteResponseSchema,
    GreetingResponseSchema,
    validateInput,
    validateResponse,
} from './schemas.js';

/**
 * Dexto Client SDK - A clean, TypeScript-first SDK for interacting with Dexto API
 *
 * This SDK provides a interface for working with Dexto agents,
 * handling HTTP communication, WebSocket events, and providing excellent DX.
 *
 * @example
 * ```typescript
 * const client = new DextoClient({
 *   baseUrl: 'https://your-dexto-server.com',
 *   apiKey: 'optional-api-key'
 * });
 *
 * await client.connect();
 *
 * const response = await client.sendMessage({
 *   content: 'Hello, how can you help me?'
 * });
 *
 * console.log(response.response);
 * ```
 */
export class DextoClient {
    private http: HttpClient;
    private ws: WebSocketClient | null = null;
    private config: ClientConfig;
    private options: ClientOptions;

    constructor(config: ClientConfig, options: ClientOptions = {}) {
        // Validate inputs with comprehensive Zod validation
        const validatedConfig = validateInput(ClientConfigSchema, config, 'ClientConfig');
        const validatedOptions = validateInput(ClientOptionsSchema, options, 'ClientOptions') || {};

        this.config = {
            timeout: 30000,
            retries: 3,
            ...validatedConfig,
        };

        this.options = {
            enableWebSocket: true,
            reconnect: true,
            reconnectInterval: 5000,
            debug: false,
            ...validatedOptions,
        };

        this.http = new HttpClient(this.config);

        if (this.options.enableWebSocket) {
            this.initializeWebSocket();
        }
    }

    private initializeWebSocket() {
        // Convert HTTP URL to WebSocket URL, preserving security scheme
        const wsUrl = this.config.baseUrl.replace(/^https/, 'wss').replace(/^http/, 'ws');

        this.ws = new WebSocketClient(wsUrl, {
            reconnect: this.options.reconnect,
            reconnectInterval: this.options.reconnectInterval,
        });
    }

    // ============= CONNECTION MANAGEMENT =============

    /**
     * Establish connection to Dexto server (including WebSocket if enabled)
     */
    async connect(): Promise<void> {
        // Test HTTP connection first
        try {
            await this.http.get('/health');
        } catch (error) {
            throw new DextoClientError('Failed to connect to Dexto server', 0, error);
        }

        // Connect WebSocket if enabled
        if (this.options.enableWebSocket) {
            if (!this.ws) {
                this.initializeWebSocket();
            }
            try {
                await this.ws!.connect();
            } catch (error) {
                if (this.options.debug) {
                    console.warn(
                        'WebSocket connection failed, continuing with HTTP-only mode:',
                        error
                    );
                }
                // Don't fail the entire connection if WebSocket fails
                this.ws = null;
            }
        }
    }

    /**
     * Disconnect from Dexto server
     */
    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    // ============= MESSAGING =============

    /**
     * Send a message to the Dexto agent
     */
    async sendMessage(input: MessageInput): Promise<MessageResponse> {
        // Validate input
        const validatedInput = validateInput(MessageInputSchema, input, 'MessageInput');

        const endpoint = validatedInput.stream ? '/api/message' : '/api/message-sync';

        const requestBody = {
            message: validatedInput.content,
            ...(validatedInput.sessionId && { sessionId: validatedInput.sessionId }),
            ...(validatedInput.stream && { stream: validatedInput.stream }),
            ...(validatedInput.imageData && { imageData: validatedInput.imageData }),
            ...(validatedInput.fileData && { fileData: validatedInput.fileData }),
        };

        const response = await this.http.post<MessageResponse>(endpoint, requestBody);

        // Validate response
        return validateResponse(MessageResponseSchema, response, 'sendMessage');
    }

    /**
     * Send a message via WebSocket for streaming responses
     */
    sendMessageStream(input: MessageInput): boolean {
        // Validate input
        const validatedInput = validateInput(MessageInputSchema, input, 'MessageInput');

        if (!this.ws || this.ws.state !== 'open') {
            throw new DextoClientError('WebSocket connection not available for streaming');
        }

        return this.ws.send({
            type: 'message',
            content: validatedInput.content,
            ...(validatedInput.sessionId && { sessionId: validatedInput.sessionId }),
            ...(validatedInput.imageData && { imageData: validatedInput.imageData }),
            ...(validatedInput.fileData && { fileData: validatedInput.fileData }),
            stream: true,
        });
    }

    // ============= SESSION MANAGEMENT =============

    /**
     * List all sessions
     */
    async listSessions(): Promise<SessionInfo[]> {
        const response = await this.http.get<{ sessions: SessionInfo[] }>('/api/sessions');
        const validatedResponse = validateResponse(
            SessionsListResponseSchema,
            response,
            'listSessions'
        );
        return validatedResponse.sessions;
    }

    /**
     * Create a new session
     */
    async createSession(sessionId?: string): Promise<SessionInfo> {
        // Validate sessionId if provided
        if (sessionId !== undefined) {
            validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId, 'sessionId');
        }

        const response = await this.http.post<{ session: SessionInfo }>('/api/sessions', {
            ...(sessionId && { sessionId }),
        });
        const validatedResponse = validateResponse(
            SessionCreateResponseSchema,
            response,
            'createSession'
        );
        return validatedResponse.session;
    }

    /**
     * Get session details
     */
    async getSession(sessionId: string): Promise<SessionInfo> {
        // Validate sessionId
        validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId, 'sessionId');

        const response = await this.http.get<{ session: SessionInfo }>(
            `/api/sessions/${sessionId}`
        );
        const validatedResponse = validateResponse(
            SessionGetResponseSchema,
            response,
            'getSession'
        );
        return validatedResponse.session;
    }

    /**
     * Get session conversation history
     */
    async getSessionHistory(sessionId: string): Promise<any[]> {
        // Validate sessionId
        validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId, 'sessionId');

        const response = await this.http.get<{ history: any[] }>(
            `/api/sessions/${sessionId}/history`
        );
        const validatedResponse = validateResponse(
            SessionHistoryResponseSchema,
            response,
            'getSessionHistory'
        );
        return validatedResponse.history;
    }

    /**
     * Delete a session permanently
     */
    async deleteSession(sessionId: string): Promise<void> {
        // Validate sessionId
        validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId, 'sessionId');

        await this.http.delete(`/api/sessions/${sessionId}`);
    }

    /**
     * Load a session as the current working session
     */
    async loadSession(sessionId: string | null): Promise<void> {
        // Validate sessionId if not null
        if (sessionId !== null) {
            validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId, 'sessionId');
        }

        const id = sessionId === null ? 'null' : sessionId;
        await this.http.post(`/api/sessions/${id}/load`);
    }

    /**
     * Get the current working session
     */
    async getCurrentSession(): Promise<string> {
        const response = await this.http.get<{ currentSessionId: string }>('/api/sessions/current');
        const validatedResponse = validateResponse(
            CurrentSessionResponseSchema,
            response,
            'getCurrentSession'
        );
        return validatedResponse.currentSessionId;
    }

    /**
     * Reset conversation (clear history while keeping session alive)
     */
    async resetConversation(sessionId?: string): Promise<void> {
        // Validate sessionId if provided
        if (sessionId !== undefined) {
            validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId, 'sessionId');
        }

        await this.http.post('/api/reset', {
            ...(sessionId && { sessionId }),
        });
    }

    // ============= LLM MANAGEMENT =============

    /**
     * Get current LLM configuration
     */
    async getCurrentLLMConfig(sessionId?: string): Promise<LLMConfig> {
        // Validate sessionId if provided
        if (sessionId !== undefined) {
            validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId, 'sessionId');
        }

        const params = sessionId ? `?sessionId=${sessionId}` : '';
        const response = await this.http.get<{ config: LLMConfig }>(`/api/llm/current${params}`);
        const validatedResponse = validateResponse(
            LLMCurrentResponseSchema,
            response,
            'getCurrentLLMConfig'
        );
        return validatedResponse.config;
    }

    /**
     * Switch LLM configuration
     */
    async switchLLM(config: Partial<LLMConfig>, sessionId?: string): Promise<LLMConfig> {
        // Validate input config
        const validatedConfig = validateInput(LLMConfigInputSchema, config, 'LLM config');

        // Validate sessionId if provided
        if (sessionId !== undefined) {
            validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId, 'sessionId');
        }

        const requestBody = {
            ...validatedConfig,
            ...(sessionId && { sessionId }),
        };

        const response = await this.http.post<{ config: LLMConfig }>(
            '/api/llm/switch',
            requestBody
        );
        const validatedResponse = validateResponse(LLMSwitchResponseSchema, response, 'switchLLM');
        return validatedResponse.config;
    }

    /**
     * Get available LLM providers and models
     */
    async getLLMProviders(): Promise<Record<string, any>> {
        const response = await this.http.get<{ providers: Record<string, any> }>(
            '/api/llm/providers'
        );
        const validatedResponse = validateResponse(
            LLMProvidersResponseSchema,
            response,
            'getLLMProviders'
        );
        return validatedResponse.providers;
    }

    /**
     * Get LLM catalog with filtering options
     */
    async getLLMCatalog(options: CatalogOptions = {}): Promise<CatalogResponse> {
        // Validate catalog options
        const validatedOptions = validateInput(CatalogOptionsSchema, options, 'catalog options');

        const params = new URLSearchParams();

        if (validatedOptions.provider) params.set('provider', validatedOptions.provider);
        if (validatedOptions.hasKey !== undefined)
            params.set('hasKey', validatedOptions.hasKey.toString());
        if (validatedOptions.router) params.set('router', validatedOptions.router);
        if (validatedOptions.fileType) params.set('fileType', validatedOptions.fileType);
        if (validatedOptions.defaultOnly) params.set('defaultOnly', 'true');
        if (validatedOptions.mode) params.set('mode', validatedOptions.mode);

        const queryString = params.toString();
        const endpoint = queryString ? `/api/llm/catalog?${queryString}` : '/api/llm/catalog';

        const response = await this.http.get<CatalogResponse>(endpoint);
        return validateResponse(CatalogResponseSchema, response, 'getLLMCatalog');
    }

    // ============= MCP SERVER MANAGEMENT =============

    /**
     * List connected MCP servers
     */
    async listMCPServers(): Promise<McpServer[]> {
        const response = await this.http.get<{ servers: McpServer[] }>('/api/mcp/servers');
        const validatedResponse = validateResponse(
            MCPServersResponseSchema,
            response,
            'listMCPServers'
        );
        return validatedResponse.servers;
    }

    /**
     * Connect to a new MCP server
     */
    async connectMCPServer(name: string, config: any): Promise<void> {
        // Validate server name
        validateInput(z.string().min(1, 'Server name cannot be empty'), name, 'server name');

        // Validate config is not null/undefined
        if (config === null || config === undefined) {
            throw new DextoClientError('Server config cannot be null or undefined');
        }

        await this.http.post('/api/mcp/servers', { name, config });
    }

    /**
     * Disconnect from an MCP server
     */
    async disconnectMCPServer(serverId: string): Promise<void> {
        // Validate serverId
        validateInput(z.string().min(1, 'Server ID cannot be empty'), serverId, 'server ID');

        await this.http.delete(`/api/mcp/servers/${serverId}`);
    }

    /**
     * Get tools from a specific MCP server
     */
    async getMCPServerTools(serverId: string): Promise<Tool[]> {
        // Validate serverId
        validateInput(z.string().min(1, 'Server ID cannot be empty'), serverId, 'server ID');

        const response = await this.http.get<{ tools: Tool[] }>(
            `/api/mcp/servers/${serverId}/tools`
        );
        const validatedResponse = validateResponse(
            MCPServerToolsResponseSchema,
            response,
            'getMCPServerTools'
        );
        return validatedResponse.tools;
    }

    /**
     * Execute a tool from an MCP server
     */
    async executeMCPTool(serverId: string, toolName: string, args: any): Promise<any> {
        // Validate serverId and toolName
        validateInput(z.string().min(1, 'Server ID cannot be empty'), serverId, 'server ID');
        validateInput(z.string().min(1, 'Tool name cannot be empty'), toolName, 'tool name');

        // Validate args is not null/undefined (empty object {} is allowed)
        if (args === null || args === undefined) {
            throw new DextoClientError('Tool arguments cannot be null or undefined');
        }

        const response = await this.http.post<{ success: boolean; data: any }>(
            `/api/mcp/servers/${serverId}/tools/${toolName}/execute`,
            args
        );
        const validatedResponse = validateResponse(
            MCPToolExecuteResponseSchema,
            response,
            'executeMCPTool'
        );
        return validatedResponse.data;
    }

    // ============= SEARCH =============

    /**
     * Search messages across sessions
     */
    async searchMessages(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
        // Validate query
        validateInput(z.string().min(1, 'Search query cannot be empty'), query, 'search query');

        // Validate search options
        const validatedOptions = validateInput(SearchOptionsSchema, options, 'search options');

        const params = new URLSearchParams({
            q: query,
            ...(validatedOptions.limit !== undefined && {
                limit: validatedOptions.limit.toString(),
            }),
            ...(validatedOptions.offset !== undefined && {
                offset: validatedOptions.offset.toString(),
            }),
            ...(validatedOptions.sessionId && { sessionId: validatedOptions.sessionId }),
            ...(validatedOptions.role && { role: validatedOptions.role }),
        } as Record<string, string>);

        const response = await this.http.get<SearchResponse>(`/api/search/messages?${params}`);
        return validateResponse(SearchResponseSchema, response, 'searchMessages');
    }

    /**
     * Search sessions that contain the query
     */
    async searchSessions(query: string): Promise<SessionSearchResponse> {
        // Validate query
        validateInput(z.string().min(1, 'Search query cannot be empty'), query, 'search query');

        const params = new URLSearchParams({ q: query });
        const response = await this.http.get<SessionSearchResponse>(
            `/api/search/sessions?${params}`
        );
        return validateResponse(SessionSearchResponseSchema, response, 'searchSessions');
    }

    // ============= EVENT HANDLING =============

    /**
     * Subscribe to real-time events
     */
    on(eventType: string, handler: EventHandler): () => void {
        if (!this.ws) {
            if (this.options.debug) {
                console.warn('WebSocket not available, events will not be received');
            }
            return () => {}; // Return no-op unsubscribe function
        }

        return this.ws.on(eventType, handler);
    }

    /**
     * Subscribe to connection state changes
     */
    onConnectionState(
        handler: (state: 'connecting' | 'open' | 'closed' | 'error') => void
    ): () => void {
        if (!this.ws) {
            return () => {};
        }

        return this.ws.onConnectionState(handler);
    }

    // ============= GREETING =============

    /**
     * Get agent greeting message
     */
    async getGreeting(sessionId?: string): Promise<string | null> {
        // Validate sessionId if provided
        if (sessionId !== undefined) {
            validateInput(z.string().min(1, 'Session ID cannot be empty'), sessionId, 'sessionId');
        }

        const params = sessionId ? `?sessionId=${sessionId}` : '';
        const response = await this.http.get<{ greeting: string | null }>(`/api/greeting${params}`);
        const validatedResponse = validateResponse(GreetingResponseSchema, response, 'getGreeting');
        return validatedResponse.greeting;
    }

    // ============= UTILITY METHODS =============

    /**
     * Get connection status
     */
    get connectionState(): 'connecting' | 'open' | 'closed' | 'error' {
        return this.ws ? this.ws.state : 'closed';
    }

    /**
     * Check if client is connected
     */
    get isConnected(): boolean {
        return this.connectionState === 'open';
    }

    /**
     * Get client configuration
     */
    get clientConfig(): Readonly<ClientConfig> {
        return { ...this.config };
    }
}
