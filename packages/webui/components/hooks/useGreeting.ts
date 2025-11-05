'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GreetingResponse } from '@/types';
import { apiFetch } from '@/lib/api-client.js';
import { queryKeys } from '@/lib/queryKeys.js';

async function fetchGreeting(sessionId?: string | null): Promise<string | null> {
    const endpoint = sessionId
        ? `/api/greeting?sessionId=${encodeURIComponent(sessionId)}`
        : `/api/greeting`;

    const data = await apiFetch<GreetingResponse>(endpoint);
    return data.greeting ?? null;
}

export function useGreeting(sessionId?: string | null) {
    const queryClient = useQueryClient();

    const {
        data: greeting = null,
        isLoading,
        error,
    } = useQuery<string | null, Error>({
        queryKey: queryKeys.greeting(sessionId),
        queryFn: () => fetchGreeting(sessionId),
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
