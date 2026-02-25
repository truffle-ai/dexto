import { MCPManager } from '../mcp/manager.js';
import type { WorkspaceContext } from '../workspace/types.js';

export type EnvironmentContext = {
    cwd?: string;
    platform?: string;
    shell?: string;
    isGitRepo?: boolean;
};

// Context passed to dynamic contributors
export interface DynamicContributorContext {
    mcpManager: MCPManager;
    workspace?: WorkspaceContext | null;
    environment?: EnvironmentContext;
}

export type DynamicContributorContextOverrides = Partial<DynamicContributorContext>;
export type DynamicContributorContextFactory = () =>
    | DynamicContributorContextOverrides
    | Promise<DynamicContributorContextOverrides>;

// Interface for all system prompt contributors
export interface SystemPromptContributor {
    id: string;
    priority: number;
    getContent(context: DynamicContributorContext): Promise<string>;
}
