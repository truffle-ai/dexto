import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client.js';
import { queryKeys } from '@/lib/queryKeys.js';

async function fetchResources() {
    const response = await client.api.resources.$get();
    const data = await response.json();
    if (!data.ok || !Array.isArray(data.resources)) {
        throw new Error('Invalid response shape');
    }
    return data.resources;
}

export function clearResourcesCache(): void {
    // This function is kept for backwards compatibility
    // TanStack Query handles cache invalidation via queryClient
}

export function useResources() {
    const queryClient = useQueryClient();

    const {
        data: resources = [],
        isLoading: loading,
        error,
        refetch: refresh,
    } = useQuery({
        queryKey: queryKeys.resources.all,
        queryFn: fetchResources,
        staleTime: 60 * 1000, // 1 minute - resources can be uploaded
    });

    // Listen for real-time resource cache invalidation events
    useEffect(() => {
        const handleResourceCacheInvalidated = (event: any) => {
            const detail = event?.detail || {};
            console.log('💾 Resource cache invalidated:', detail);

            // Invalidate and refetch resources when cache is invalidated
            queryClient.invalidateQueries({ queryKey: queryKeys.resources.all });
        };

        const handleAgentSwitched = (event: any) => {
            const detail = event?.detail || {};
            console.log('🔁 Agent switched, refreshing resources:', detail);

            // Invalidate and refetch resources when agent is switched
            queryClient.invalidateQueries({ queryKey: queryKeys.resources.all });
        };

        // Listen for our custom event that gets dispatched when resources change
        if (typeof window !== 'undefined') {
            window.addEventListener('resource:cache-invalidated', handleResourceCacheInvalidated);
            window.addEventListener('dexto:agentSwitched', handleAgentSwitched);

            return () => {
                window.removeEventListener(
                    'resource:cache-invalidated',
                    handleResourceCacheInvalidated
                );
                window.removeEventListener('dexto:agentSwitched', handleAgentSwitched);
            };
        }
    }, [queryClient]);

    return {
        resources,
        loading,
        error: error?.message ?? null,
        refresh: async () => {
            await refresh();
        },
    } as const;
}
