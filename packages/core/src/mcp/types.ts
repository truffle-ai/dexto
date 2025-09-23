import { ValidatedMcpServerConfig } from './schemas.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ToolProvider } from '../tools/types.js';
import {
    CreateMessageRequest,
    CreateMessageResult,
    GetPromptResult,
    ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import { EventEmitter } from 'events';
import { ElicitationDetails, ElicitationResponse } from '../tools/confirmation/types.js';

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

export interface SamplingRequestContext {
    /** Human-friendly name reported by the MCP client (alias/command). */
    clientName: string;
    /** Internal identifier used by Dexto for this MCP server. */
    serverName: string;
}

export type SamplingRequestHandler = (
    params: CreateMessageRequest['params'],
    context: SamplingRequestContext
) => Promise<CreateMessageResult>;

/**
 * Interface for MCP clients specifically, that can provide tools
 */
export interface IMCPClient extends ToolProvider, EventEmitter {
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

    // Elicitation Management
    requestElicitation?(details: ElicitationDetails): Promise<ElicitationResponse>;

    // Roots Management
    setRoots?(roots: Array<{ uri: string; name?: string }>): void;
    getRoots?(): Array<{ uri: string; name?: string }>;
    notifyRootsListChanged?(): Promise<void>;

    // Sampling Management
    setSamplingEnabled?(enabled: boolean): void;
    isSamplingEnabled?(): boolean;
    setSamplingHandler?(handler: SamplingRequestHandler | null): void;
}
