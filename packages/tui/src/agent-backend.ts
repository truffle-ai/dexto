import type { AgentEventMap, DextoAgent, SessionMetadata } from '@dexto/core';
import type { CommandDefinition } from './interactive-commands/command-parser.js';

export interface TuiAgentCapabilities {
    supportedCommands?: readonly string[];
    prompts?: boolean;
    resources?: boolean;
    attachments?: boolean;
    reasoningCycle?: boolean;
    contextStats?: boolean;
    startupInfo?: boolean;
}

type RootLogger = Pick<
    DextoAgent['logger'],
    'debug' | 'info' | 'warn' | 'error' | 'getLevel' | 'getLogFilePath'
>;

interface TuiSessionStats {
    totalSessions: number;
    inMemorySessions: number;
    maxSessions: number;
}

export interface TuiEffectiveConfig {
    llm: {
        provider: string;
        model: string;
        maxOutputTokens?: number | null | undefined;
        temperature?: number | null | undefined;
    };
    permissions: {
        mode: string;
    };
    sessions?:
        | {
              maxSessions?: number | undefined;
              sessionTTL?: number | undefined;
          }
        | undefined;
    mcpServers?: Record<string, unknown> | undefined;
    prompts?: unknown[] | undefined;
    [key: string]: unknown;
}

export interface TuiAgentBackend
    extends Pick<
        DextoAgent,
        | 'stream'
        | 'stop'
        | 'run'
        | 'listSessions'
        | 'getSessionMetadata'
        | 'getSessionHistory'
        | 'getSessionTitle'
        | 'setSessionTitle'
        | 'generateSessionTitle'
        | 'forkSession'
        | 'getCurrentLLMConfig'
        | 'switchLLM'
        | 'getSupportedProviders'
        | 'getSupportedModels'
        | 'getContextStats'
        | 'clearContext'
        | 'compactContext'
        | 'queueMessage'
        | 'getQueuedMessages'
        | 'removeQueuedMessage'
        | 'clearMessageQueue'
        | 'cancel'
        | 'searchMessages'
        | 'listPrompts'
        | 'refreshPrompts'
        | 'resolvePrompt'
        | 'getSystemPrompt'
        | 'loadToolkits'
        | 'listResources'
        | 'setLogLevel'
        | 'getAllTools'
        | 'getEnabledTools'
        | 'getAllMcpTools'
        | 'setGlobalDisabledTools'
        | 'setSessionDisabledTools'
        | 'setSessionAutoApproveTools'
        | 'getSessionAutoApproveTools'
        | 'getMcpServersWithStatus'
        | 'addMcpServer'
        | 'enableMcpServer'
        | 'disableMcpServer'
        | 'removeMcpServer'
        | 'restartMcpServer'
        | 'getMcpClients'
        | 'getMcpFailedConnections'
    > {
    createSession: (sessionId?: string) => Promise<{
        id: string;
        logger: Pick<RootLogger, 'getLevel' | 'getLogFilePath'>;
    }>;
    getSession: (sessionId: string) => Promise<
        | {
              id: string;
              logger: Pick<RootLogger, 'getLevel' | 'getLogFilePath'>;
          }
        | undefined
    >;
    getEffectiveConfig: (sessionId?: string) => TuiEffectiveConfig;
    on: <K extends keyof AgentEventMap>(
        event: K,
        listener: AgentEventMap[K] extends void ? () => void : (payload: AgentEventMap[K]) => void,
        options?: { signal?: AbortSignal }
    ) => void;
    emit: <K extends keyof AgentEventMap>(
        event: K,
        ...args: AgentEventMap[K] extends void ? [] : [AgentEventMap[K]]
    ) => boolean;
    logger: RootLogger;
    config: {
        agentId: string;
    };
    sessionManager: {
        getSessionMetadata: (sessionId: string) => Promise<SessionMetadata | undefined>;
        getSessionStats: () => Promise<TuiSessionStats>;
    };
    mcpManager: {
        getClients: () => Map<string, unknown>;
        getFailedConnections: () => Record<string, unknown>;
    };
    toolManager: {
        addSessionAutoApproveTools: (
            sessionId: string,
            toolNames: string[]
        ) => void | Promise<void>;
    };
    services: {
        hookManager: {
            getHookNames: () => string[];
        };
    };
    capabilities?: TuiAgentCapabilities;
}

const DEFAULT_CAPABILITIES: Required<Omit<TuiAgentCapabilities, 'supportedCommands'>> = {
    prompts: true,
    resources: true,
    attachments: true,
    reasoningCycle: true,
    contextStats: true,
    startupInfo: true,
};

function normalizeCommandName(command: string): string {
    return command.trim().toLowerCase();
}

export function getTuiCapabilities(agent: TuiAgentBackend): TuiAgentCapabilities {
    return {
        ...DEFAULT_CAPABILITIES,
        ...agent.capabilities,
        ...(agent.capabilities?.supportedCommands
            ? {
                  supportedCommands: agent.capabilities.supportedCommands.map(normalizeCommandName),
              }
            : {}),
    };
}

export function isCommandSupported(
    agent: TuiAgentBackend,
    command: string,
    definition?: Pick<CommandDefinition, 'name' | 'aliases'>
): boolean {
    const supportedCommands = getTuiCapabilities(agent).supportedCommands;
    if (!supportedCommands) {
        return true;
    }

    const candidates = new Set<string>([normalizeCommandName(command)]);
    if (definition?.name) {
        candidates.add(normalizeCommandName(definition.name));
    }
    for (const alias of definition?.aliases ?? []) {
        candidates.add(normalizeCommandName(alias));
    }

    return Array.from(candidates).some((candidate) => supportedCommands.includes(candidate));
}

export function isCommandDefinitionSupported(
    agent: TuiAgentBackend,
    definition: Pick<CommandDefinition, 'name' | 'aliases'>
): boolean {
    return isCommandSupported(agent, definition.name, definition);
}

export function supportsPrompts(agent: TuiAgentBackend): boolean {
    return getTuiCapabilities(agent).prompts ?? true;
}

export function supportsResources(agent: TuiAgentBackend): boolean {
    return getTuiCapabilities(agent).resources ?? true;
}

export function supportsAttachments(agent: TuiAgentBackend): boolean {
    return getTuiCapabilities(agent).attachments ?? true;
}

export function supportsReasoningCycle(agent: TuiAgentBackend): boolean {
    return getTuiCapabilities(agent).reasoningCycle ?? true;
}

export function supportsContextStats(agent: TuiAgentBackend): boolean {
    return getTuiCapabilities(agent).contextStats ?? true;
}

export function supportsStartupInfo(agent: TuiAgentBackend): boolean {
    return getTuiCapabilities(agent).startupInfo ?? true;
}
