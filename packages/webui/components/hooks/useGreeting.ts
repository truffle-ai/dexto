'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client.js';
import { queryKeys } from '@/lib/queryKeys.js';

async function fetchGreeting(sessionId?: string | null): Promise<string | null> {
    const data = await client.api.greeting.$get({
        query: sessionId ? { sessionId } : {},
    });
    if (!data.ok) {
        throw new Error(`Failed to fetch greeting: ${data.status}`);
    }
    const json = await data.json();
    return json.greeting ?? null;
}

export function useGreeting(sessionId?: string | null) {
    const queryClient = useQueryClient();

    const {
        data: greeting = null,
        isLoading,
        error,
    } = useQuery({
        queryKey: queryKeys.greeting(sessionId),
        queryFn: () => fetchGreeting(sessionId),
        staleTime: 5 * 60 * 1000, // 5 minutes - greeting is static per agent
    });

    // Listen for agent switching events to refresh greeting
    useEffect(() => {
        const handleAgentSwitched = () => {
            // Invalidate all greeting queries (hierarchical invalidation)
            queryClient.invalidateQueries({ queryKey: [queryKeys.greeting(sessionId)[0]] });
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('dexto:agentSwitched', handleAgentSwitched);
            return () => {
                window.removeEventListener('dexto:agentSwitched', handleAgentSwitched);
            };
        }
        // queryClient is a stable reference from TanStack Query, safe to omit
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    return { greeting, isLoading, error: error?.message ?? null };
}
