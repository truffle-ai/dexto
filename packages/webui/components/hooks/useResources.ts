import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiUrl } from '@/lib/api-url';
import type { ResourceMetadata } from '@dexto/core';

async function fetchResources(): Promise<ResourceMetadata[]> {
    const response = await fetch(`${getApiUrl()}/api/resources`);
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text ? `HTTP ${response.status}: ${text}` : `HTTP ${response.status}`);
    }
    const body = await response.json();
    if (!body || !body.ok || !Array.isArray(body.resources)) {
        throw new Error('Invalid response shape');
    }
    return body.resources as ResourceMetadata[];
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
        queryKey: ['resources'],
        queryFn: fetchResources,
    });

    // Listen for real-time resource cache invalidation events
    useEffect(() => {
        const handleResourceCacheInvalidated = (event: any) => {
            const detail = event?.detail || {};
            console.log('💾 Resource cache invalidated:', detail);

            // Invalidate and refetch resources when cache is invalidated
            queryClient.invalidateQueries({ queryKey: ['resources'] });
        };

        const handleAgentSwitched = (event: any) => {
            const detail = event?.detail || {};
            console.log('🔁 Agent switched, refreshing resources:', detail);

            // Invalidate and refetch resources when agent is switched
            queryClient.invalidateQueries({ queryKey: ['resources'] });
        };

        // Listen for our custom WebSocket event that gets dispatched when resources change
        if (typeof window !== 'undefined') {
            window.addEventListener(
                'dexto:resourceCacheInvalidated',
                handleResourceCacheInvalidated
            );
            window.addEventListener('dexto:agentSwitched', handleAgentSwitched);

            return () => {
                window.removeEventListener(
                    'dexto:resourceCacheInvalidated',
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
