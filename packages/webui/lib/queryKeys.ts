/**
 * Centralized query key factory for TanStack Query
 *
 * Benefits:
 * - Single source of truth for all query keys
 * - TypeScript autocomplete support
 * - Hierarchical invalidation (e.g., invalidate all agent queries)
 * - Prevents typos and inconsistencies
 *
 * Usage:
 * - useQuery({ queryKey: queryKeys.agents.all, ... })
 * - queryClient.invalidateQueries({ queryKey: queryKeys.agents.all })
 */

import type { ServerRegistryFilter } from '@dexto/registry';

export const queryKeys = {
    // Agent-related queries
    agents: {
        all: ['agents'] as const,
        path: ['agentPath'] as const,
    },

    // Agent configuration queries
    agent: {
        config: ['agent', 'config'] as const,
    },

    // LLM configuration queries
    llm: {
        current: (sessionId: string | null | undefined) =>
            ['llm', 'current', sessionId ?? null] as const,
        catalog: ['llm', 'catalog'] as const,
        customModels: ['llm', 'customModels'] as const,
        modelPickerState: ['llm', 'modelPickerState'] as const,
    },

    // Session-related queries
    sessions: {
        all: ['sessions'] as const,
        detail: (sessionId: string) => ['sessions', 'detail', sessionId] as const,
        history: (sessionId: string) => ['sessions', 'history', sessionId] as const,
    },

    // Search queries
    search: {
        messages: (query: string, sessionId?: string, limit?: number) =>
            ['search', 'messages', query, sessionId, limit] as const,
        sessions: (query: string) => ['search', 'sessions', query] as const,
    },

    // Greeting queries
    greeting: (sessionId: string | null | undefined) =>
        ['greeting', sessionId ?? 'default'] as const,

    // Memory queries
    memories: {
        all: ['memories'] as const,
    },

    // Resource queries
    resources: {
        all: ['resources'] as const,
    },

    // Server registry queries
    serverRegistry: (filter: ServerRegistryFilter) => ['serverRegistry', filter] as const,

    // Prompt queries
    prompts: {
        all: ['prompts'] as const,
    },

    // MCP Server queries
    servers: {
        all: ['servers'] as const,
        detail: (serverId: string) => ['servers', 'detail', serverId] as const,
        tools: (serverId: string) => ['servers', 'tools', serverId] as const,
    },

    // Tools queries (all tools from all sources)
    tools: {
        all: ['tools'] as const,
    },

    // Message queue queries
    queue: {
        list: (sessionId: string) => ['queue', sessionId] as const,
    },

    // Approval queries
    approvals: {
        pending: (sessionId: string) => ['approvals', 'pending', sessionId] as const,
    },

    // Discovery queries (available providers and capabilities)
    discovery: {
        all: ['discovery'] as const,
    },

    // Model queries (local GGUF and Ollama)
    models: {
        local: ['models', 'local'] as const,
        ollama: (baseURL?: string) => ['models', 'ollama', baseURL ?? 'default'] as const,
        validateLocal: ['models', 'validateLocal'] as const,
    },

    // Dexto auth queries
    dextoAuth: {
        status: ['dextoAuth', 'status'] as const,
    },
} as const;
