import { ValidatedMcpServerConfig } from './schemas.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ToolProvider } from '../tools/types.js';
import { GetPromptResult, ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

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
export interface IMCPClient extends ToolProvider {
    // Connection Management
    connect(config: ValidatedMcpServerConfig, serverName: string): Promise<Client>;
    disconnect?(): Promise<void>;

    // Prompt Management
    listPrompts(): Promise<string[]>;
    getPrompt(name: string, args?: Record<string, unknown>): Promise<GetPromptResult>;

    // Resource Management
    listResources(): Promise<MCPResourceSummary[]>;
    readResource(uri: string): Promise<ReadResourceResult>;

    // MCP Client Management
    getConnectedClient(): Promise<Client>;
}
