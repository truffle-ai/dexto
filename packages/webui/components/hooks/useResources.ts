import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ResourceMetadata } from '@dexto/core';
import { apiFetch } from '@/lib/api-client.js';
import { queryKeys } from '@/lib/queryKeys.js';

async function fetchResources(): Promise<ResourceMetadata[]> {
    const body = await apiFetch<{ ok: boolean; resources: ResourceMetadata[] }>('/api/resources');
    if (!body || !body.ok || !Array.isArray(body.resources)) {
        throw new Error('Invalid response shape');
    }
    return body.resources;
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
    } = useQuery<ResourceMetadata[], Error>({
        queryKey: queryKeys.resources.all,
        queryFn: fetchResources,
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
