import { ValidatedMcpServerConfig } from './schemas.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { ToolProvider } from '../tools/types.js';
import { GetPromptResult, ReadResourceResult, Prompt } from '@modelcontextprotocol/sdk/types.js';
import { EventEmitter } from 'events';

export interface McpAuthProvider extends OAuthClientProvider {
    waitForAuthorizationCode?: () => Promise<string>;
}

export type McpAuthProviderFactory = (
    serverName: string,
    config: ValidatedMcpServerConfig
) => McpAuthProvider | null | undefined;

export interface MCPResourceSummary {
    uri: string;
    name?: string;
    description?: string;
    mimeType?: string;
}

export interface MCPResolvedResource {
    key: string;
    serverName: string;
    summary: MCPResourceSummary;
}

/**
 * Interface for MCP clients specifically, that can provide tools
 */
export interface IMCPClient extends ToolProvider, EventEmitter {
    // Connection Management
    connect(config: ValidatedMcpServerConfig, serverName: string): Promise<Client>;
    disconnect(): Promise<void>;

    // Prompt Management
    listPrompts(): Promise<Prompt[]>;
    getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult>;

    // Resource Management
    listResources(): Promise<MCPResourceSummary[]>;
    readResource(uri: string): Promise<ReadResourceResult>;

    // MCP Client Management
    getConnectedClient(): Promise<Client>;
}
