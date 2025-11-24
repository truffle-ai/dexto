import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

export function useCreatePrompt() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (
            payload: Parameters<typeof client.api.prompts.custom.$post>[0]['json']
        ) => {
            const response = await client.api.prompts.custom.$post({ json: payload });
            if (!response.ok) {
                throw new Error(`Failed to create prompt: ${response.status}`);
            }
            return await response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.prompts.all });
        },
    });
}

type ResolvePromptParams = Parameters<(typeof client.api.prompts)[':name']['resolve']['$get']>[0];

export function useResolvePrompt() {
    return useMutation({
        mutationFn: async (
            payload: {
                name: string;
            } & ResolvePromptParams['query']
        ) => {
            const { name, ...query } = payload;
            const response = await client.api.prompts[':name'].resolve.$get({
                param: { name: encodeURIComponent(name) },
                query,
            });

            if (!response.ok) {
                throw new Error(`Failed to resolve prompt: ${response.status}`);
            }

            return await response.json();
        },
    });
}

// Export inferred types for components to use
export type Prompt = NonNullable<ReturnType<typeof usePrompts>['data']>[number];
