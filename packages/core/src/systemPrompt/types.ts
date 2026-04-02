import { MCPManager } from '../mcp/manager.js';
import type { SessionPromptContributor } from './schemas.js';
import type { WorkspaceContext } from '../workspace/types.js';

export type EnvironmentContext = {
    cwd?: string;
    platform?: string;
    shell?: string;
    isGitRepo?: boolean;
};

export type SessionContext = {
    id: string;
    systemPromptContributors?: SessionPromptContributor[];
};

// Context passed to dynamic contributors
export interface DynamicContributorContext {
    mcpManager: MCPManager;
    workspace?: WorkspaceContext | null;
    environment?: EnvironmentContext;
    session?: SessionContext | null;
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
