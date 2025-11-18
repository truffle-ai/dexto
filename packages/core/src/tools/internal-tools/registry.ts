import { InternalTool } from '../types.js';
import { SearchService } from '../../search/index.js';
import { ApprovalManager } from '../../approval/manager.js';
import { FileSystemService } from '../../filesystem/index.js';
import { ProcessService } from '../../process/index.js';
import { createSearchHistoryTool } from './implementations/search-history-tool.js';
import { createAskUserTool } from './implementations/ask-user-tool.js';
import { createReadFileTool } from './implementations/read-file-tool.js';
import { createGlobFilesTool } from './implementations/glob-files-tool.js';
import { createGrepContentTool } from './implementations/grep-content-tool.js';
import { createWriteFileTool } from './implementations/write-file-tool.js';
import { createEditFileTool } from './implementations/edit-file-tool.js';
import { createBashExecTool } from './implementations/bash-exec-tool.js';
import { createBashOutputTool } from './implementations/bash-output-tool.js';
import { createKillProcessTool } from './implementations/kill-process-tool.js';
import { createDelegateToUrlTool } from './implementations/delegate-to-url-tool.js';
import { createSpawnAgentTool } from './implementations/spawn-agent-tool.js';
import type { KnownInternalTool } from './constants.js';
import type { DextoAgent } from '../../agent/DextoAgent.js';
import type { AgentConfig } from '../../agent/schemas.js';

/**
 * Agent resolver interface for spawn_agent tool
 * Resolves agent identifiers to AgentConfig objects
 */
export interface AgentResolver {
    /**
     * Resolve an agent identifier to an AgentConfig
     * @param agentId - Agent identifier (e.g., 'general-purpose', 'code-reviewer')
     * @returns Promise resolving to the agent configuration
     * @throws Error if agent cannot be resolved
     */
    resolveAgentConfig(agentId: string): Promise<AgentConfig>;
}

/**
 * Services available to internal tools
 * Add new services here as needed for internal tools
 */
export interface InternalToolsServices {
    searchService?: SearchService;
    approvalManager?: ApprovalManager;
    fileSystemService?: FileSystemService;
    processService?: ProcessService;
    agent?: DextoAgent;
    agentResolver?: AgentResolver;
    // Future services can be added here:
    // storageManager?: StorageManager;
    // eventBus?: AgentEventBus;
}

/**
 * Internal tool factory function type
 */
type InternalToolFactory = (services: InternalToolsServices) => InternalTool;

/**
 * Internal tool registry - Must match names array exactly (TypeScript enforces this)
 */
export const INTERNAL_TOOL_REGISTRY: Record<
    KnownInternalTool,
    {
        factory: InternalToolFactory;
        requiredServices: readonly (keyof InternalToolsServices)[];
    }
> = {
    search_history: {
        factory: (services: InternalToolsServices) =>
            createSearchHistoryTool(services.searchService!),
        requiredServices: ['searchService'] as const,
    },
    ask_user: {
        factory: (services: InternalToolsServices) => createAskUserTool(services.approvalManager!),
        requiredServices: ['approvalManager'] as const,
    },
    read_file: {
        factory: (services: InternalToolsServices) =>
            createReadFileTool(services.fileSystemService!),
        requiredServices: ['fileSystemService'] as const,
    },
    glob_files: {
        factory: (services: InternalToolsServices) =>
            createGlobFilesTool(services.fileSystemService!),
        requiredServices: ['fileSystemService'] as const,
    },
    grep_content: {
        factory: (services: InternalToolsServices) =>
            createGrepContentTool(services.fileSystemService!),
        requiredServices: ['fileSystemService'] as const,
    },
    write_file: {
        factory: (services: InternalToolsServices) =>
            createWriteFileTool(services.fileSystemService!),
        requiredServices: ['fileSystemService'] as const,
    },
    edit_file: {
        factory: (services: InternalToolsServices) =>
            createEditFileTool(services.fileSystemService!),
        requiredServices: ['fileSystemService'] as const,
    },
    bash_exec: {
        factory: (services: InternalToolsServices) =>
            createBashExecTool(services.processService!, services.approvalManager!),
        requiredServices: ['processService', 'approvalManager'] as const,
    },
    bash_output: {
        factory: (services: InternalToolsServices) =>
            createBashOutputTool(services.processService!),
        requiredServices: ['processService'] as const,
    },
    kill_process: {
        factory: (services: InternalToolsServices) =>
            createKillProcessTool(services.processService!),
        requiredServices: ['processService'] as const,
    },
    delegate_to_url: {
        factory: (_services: InternalToolsServices) => createDelegateToUrlTool(),
        requiredServices: [] as const,
    },
    spawn_agent: {
        factory: (services: InternalToolsServices) =>
            createSpawnAgentTool(services.agent!, services.agentResolver!),
        requiredServices: ['agent', 'agentResolver'] as const,
    },
};

/**
 * Type-safe registry access
 */
export function getInternalToolInfo(toolName: KnownInternalTool) {
    return INTERNAL_TOOL_REGISTRY[toolName];
}
