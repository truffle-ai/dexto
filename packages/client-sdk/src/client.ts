import { HttpClient } from './http-client.js';
import {
    ClientConfig,
    ClientOptions,
    MessageInput,
    MessageResponse,
    SessionMetadata,
    LLMConfig,
    McpServer,
    Tool,
    SearchOptions,
    SearchResponse,
    SessionSearchResponse,
    CatalogOptions,
    CatalogResponse,
    ClientProviderInfo,
} from './types.js';
import { ClientError } from './errors.js';
import { isValidUrl } from './schemas.js';

/**
 * Dexto Client SDK - Ultra-lightweight HTTP wrapper
 *
 * This SDK provides a thin interface for interacting with Dexto API.
 * All validation is handled by the server - we just pass data through.
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
    private config: ClientConfig;
    private options: ClientOptions;

    constructor(config: ClientConfig, options: ClientOptions = {}) {
        // Basic config validation only
        if (!isValidUrl(config.baseUrl)) {
            throw ClientError.invalidConfig(
                'baseUrl',
                config.baseUrl,
                'Must be a valid HTTP/HTTPS URL'
            );
        }

        this.config = {
            baseUrl: config.baseUrl,
            apiKey: config.apiKey,
            timeout: config.timeout ?? 30000,
            retries: config.retries ?? 3,
        };

        this.options = {
            debug: options.debug ?? false,
        };

        this.http = new HttpClient(this.config);
    }

    // ============= CONNECTION MANAGEMENT =============

    /**
     * Establish connection to Dexto server
     */
    async connect(): Promise<void> {
        // Test HTTP connection
        try {
            await this.http.get('/health');
        } catch (error) {
            throw ClientError.connectionFailed(
                this.config.baseUrl,
                error instanceof Error ? error : undefined
            );
        }
    }

    /**
     * Disconnect from Dexto server
     */
    disconnect(): void {
        // No-op for HTTP-only client
    }

    // ============= MESSAGING =============

    /**
     * Send a message to the Dexto agent
     */
    async sendMessage(input: MessageInput): Promise<MessageResponse> {
        if (input.stream === true) {
            throw ClientError.invalidConfig(
                'input.stream',
                input.stream,
                'Use sendMessageStream() for streaming responses'
            );
        }

        const endpoint = '/api/message-sync';
        const requestBody = {
            message: input.content,
            ...(input.sessionId && { sessionId: input.sessionId }),
            ...(input.imageData && { imageData: input.imageData }),
            ...(input.fileData && { fileData: input.fileData }),
        };

        return this.http.post<MessageResponse>(endpoint, requestBody);
    }

    // ============= SESSION MANAGEMENT =============

    /**
     * List all sessions
     */
    async listSessions(): Promise<SessionMetadata[]> {
        const response = await this.http.get<{ sessions: SessionMetadata[] }>('/api/sessions');
        return response.sessions;
    }

    /**
     * Create a new session
     */
    async createSession(sessionId?: string): Promise<SessionMetadata> {
        const response = await this.http.post<{ session: SessionMetadata }>('/api/sessions', {
            ...(sessionId && { sessionId }),
        });
        return response.session;
    }

    /**
     * Get session details
     */
    async getSession(sessionId: string): Promise<SessionMetadata> {
        const response = await this.http.get<{ session: SessionMetadata }>(
            `/api/sessions/${encodeURIComponent(sessionId)}`
        );
        return response.session;
    }

    /**
     * Get session conversation history
     */
    async getSessionHistory(sessionId: string): Promise<any[]> {
        const response = await this.http.get<{ history: unknown[] }>(
            `/api/sessions/${encodeURIComponent(sessionId)}/history`
        );
        return response.history;
    }

    /**
     * Delete a session permanently
     */
    async deleteSession(sessionId: string): Promise<void> {
        await this.http.delete(`/api/sessions/${encodeURIComponent(sessionId)}`);
    }

    /**
     * Load a session as the current working session
     */
    async loadSession(sessionId: string | null): Promise<void> {
        const id = sessionId === null ? 'null' : sessionId;
        await this.http.post(`/api/sessions/${encodeURIComponent(id)}/load`);
    }

    /**
     * Get the current working session
     */
    async getCurrentSession(): Promise<string> {
        const response = await this.http.get<{ currentSessionId: string }>('/api/sessions/current');
        return response.currentSessionId;
    }

    /**
     * Reset conversation (clear history while keeping session alive)
     */
    async resetConversation(sessionId?: string): Promise<void> {
        await this.http.post('/api/reset', {
            ...(sessionId && { sessionId }),
        });
    }

    // ============= LLM MANAGEMENT =============

    /**
     * Get current LLM configuration
     */
    async getCurrentLLMConfig(sessionId?: string): Promise<LLMConfig> {
        const params = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
        const response = await this.http.get<{ config: LLMConfig }>(`/api/llm/current${params}`);
        return response.config;
    }

    /**
     * Switch LLM configuration
     */
    async switchLLM(config: Partial<LLMConfig>, sessionId?: string): Promise<LLMConfig> {
        const requestBody = {
            ...config,
            ...(sessionId && { sessionId }),
        };

        const response = await this.http.post<{ config: LLMConfig }>(
            '/api/llm/switch',
            requestBody
        );
        return response.config;
    }

    /**
     * Get available LLM providers and models
     */
    async getLLMProviders(): Promise<Record<string, ClientProviderInfo>> {
        const response = await this.http.get<{ providers: Record<string, ClientProviderInfo> }>(
            '/api/llm/providers'
        );
        return response.providers;
    }

    /**
     * Get LLM catalog with filtering options
     */
    async getLLMCatalog(options: CatalogOptions = {}): Promise<CatalogResponse> {
        const params = new globalThis.URLSearchParams();

        if (options.provider) params.set('provider', options.provider);
        if (options.hasKey !== undefined) params.set('hasKey', options.hasKey.toString());
        if (options.router) params.set('router', options.router);
        if (options.fileType) params.set('fileType', options.fileType);
        if (options.defaultOnly) params.set('defaultOnly', 'true');
        if (options.mode) params.set('mode', options.mode);

        const queryString = params.toString();
        const endpoint = queryString ? `/api/llm/catalog?${queryString}` : '/api/llm/catalog';

        return this.http.get<CatalogResponse>(endpoint);
    }

    // ============= MCP SERVER MANAGEMENT =============

    /**
     * List connected MCP servers
     */
    async listMCPServers(): Promise<McpServer[]> {
        const response = await this.http.get<{ servers: McpServer[] }>('/api/mcp/servers');
        return response.servers;
    }

    /**
     * Connect to a new MCP server
     */
    async connectMCPServer(name: string, config: Record<string, unknown>): Promise<void> {
        await this.http.post('/api/mcp/servers', { name, config });
    }

    /**
     * Disconnect from an MCP server
     */
    async disconnectMCPServer(serverId: string): Promise<void> {
        await this.http.delete(`/api/mcp/servers/${encodeURIComponent(serverId)}`);
    }

    /**
     * Get tools from a specific MCP server
     */
    async getMCPServerTools(serverId: string): Promise<Tool[]> {
        const response = await this.http.get<{ tools: Tool[] }>(
            `/api/mcp/servers/${encodeURIComponent(serverId)}/tools`
        );
        return response.tools;
    }

    /**
     * Execute a tool from an MCP server
     */
    async executeMCPTool(serverId: string, toolName: string, args: unknown): Promise<unknown> {
        const response = await this.http.post<{ success: boolean; data: unknown }>(
            `/api/mcp/servers/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolName)}/execute`,
            args
        );
        return response.data;
    }

    // ============= SEARCH =============

    /**
     * Search messages across sessions
     */
    async searchMessages(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
        const params = new globalThis.URLSearchParams();
        params.append('q', query);
        if (options.limit !== undefined) params.append('limit', String(options.limit));
        if (options.offset !== undefined) params.append('offset', String(options.offset));
        if (options.sessionId) params.append('sessionId', options.sessionId);
        if (options.role) params.append('role', options.role);

        return this.http.get<SearchResponse>(`/api/search/messages?${params}`);
    }

    /**
     * Search sessions that contain the query
     */
    async searchSessions(query: string): Promise<SessionSearchResponse> {
        const params = new globalThis.URLSearchParams({ q: query });
        return this.http.get<SessionSearchResponse>(`/api/search/sessions?${params}`);
    }

    // ============= GREETING =============

    /**
     * Get agent greeting message
     */
    async getGreeting(sessionId?: string): Promise<string | null> {
        const params = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
        const response = await this.http.get<{ greeting: string | null }>(`/api/greeting${params}`);
        return response.greeting;
    }

    // ============= UTILITY METHODS =============

    /**
     * Get client configuration
     */
    get clientConfig(): Readonly<ClientConfig> {
        return { ...this.config };
    }
}
