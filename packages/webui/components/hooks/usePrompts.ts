import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { client } from '@/lib/client.js';

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
            const response = await client.api.prompts.$get();
            const data = await response.json();
            return data.prompts;
        },
        staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
        gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
        ...options,
    });
}
