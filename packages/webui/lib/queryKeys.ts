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

import type { ServerRegistryFilter } from '@/types';

export const queryKeys = {
    // Agent-related queries
    agents: {
        all: ['agents'] as const,
        path: ['agentPath'] as const,
    },

    // LLM configuration queries
    llm: {
        current: (sessionId: string | null | undefined) =>
            ['llm', 'current', sessionId ?? null] as const,
    },

    // Session-related queries
    sessions: {
        all: ['sessions'] as const,
        detail: (sessionId: string) => ['sessions', 'detail', sessionId] as const,
        history: (sessionId: string) => ['sessions', 'history', sessionId] as const,
    },

    // Search queries
    search: {
        messages: (query: string) => ['search', 'messages', query] as const,
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
} as const;
