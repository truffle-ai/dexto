import { MCPManager } from '../mcp/manager.js';

// Context passed to dynamic contributors
export interface DynamicContributorContext {
    mcpManager: MCPManager;
}

// Interface for all system prompt contributors
export interface SystemPromptContributor {
    id: string;
    priority: number;
    getContent(context: DynamicContributorContext): Promise<string>;
}
