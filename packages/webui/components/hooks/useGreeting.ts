'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GreetingResponse } from '@/types';
import { getApiUrl } from '@/lib/api-url';

async function fetchGreeting(sessionId?: string | null): Promise<string | null> {
    const url = sessionId
        ? `${getApiUrl()}/api/greeting?sessionId=${encodeURIComponent(sessionId)}`
        : `${getApiUrl()}/api/greeting`;

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to fetch greeting: HTTP ${response.status} ${response.statusText}`);
    }

    const data: GreetingResponse = await response.json();
    return data.greeting ?? null;
}

export function useGreeting(sessionId?: string | null) {
    const queryClient = useQueryClient();

    const {
        data: greeting = null,
        isLoading,
        error,
    } = useQuery<string | null, Error>({
        queryKey: ['greeting', sessionId ?? 'default'],
        queryFn: () => fetchGreeting(sessionId),
    });

    // Listen for agent switching events to refresh greeting
    useEffect(() => {
        const handleAgentSwitched = () => {
            queryClient.invalidateQueries({ queryKey: ['greeting'] });
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('dexto:agentSwitched', handleAgentSwitched);
            return () => {
                window.removeEventListener('dexto:agentSwitched', handleAgentSwitched);
            };
        }
    }, [queryClient]);

    return { greeting, isLoading, error: error?.message ?? null };
}
