import { useQuery } from '@tanstack/react-query';
import type { PromptInfo } from '@dexto/core';
import { queryKeys } from '@/lib/queryKeys';
import { apiFetch } from '@/lib/api-client';

/**
 * Hook for fetching prompts with TanStack Query caching
 *
 * Replaces the old promptCache.ts in-memory cache with proper
 * persistent caching that survives page refreshes.
 */
export function usePrompts(options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: queryKeys.prompts.all,
        queryFn: async () => {
            const response = await apiFetch<{ prompts: PromptInfo[] }>('/api/prompts');
            return response.prompts;
        },
        staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
        gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
        ...options,
    });
}
