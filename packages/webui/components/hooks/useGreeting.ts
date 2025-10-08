'use client';

import { useState, useEffect } from 'react';
import type { GreetingResponse } from '@/types';

export function useGreeting(sessionId?: string | null) {
    const [greeting, setGreeting] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [agentVersion, setAgentVersion] = useState(0);

    const fetchGreeting = async (signal: AbortSignal) => {
        setIsLoading(true);
        setError(null);

        try {
            const url = sessionId
                ? `/api/greeting?sessionId=${encodeURIComponent(sessionId)}`
                : '/api/greeting';

            const response = await fetch(url, { signal });

            if (!response.ok) {
                const msg = `Failed to fetch greeting: HTTP ${response.status} ${response.statusText}`;
                setGreeting(null);
                setError(msg);
                return;
            }

            const data: GreetingResponse = await response.json();
            setGreeting(data.greeting ?? null);
        } catch (err) {
            // Ignore abort errors
            if ((err as any)?.name === 'AbortError') return;
            const errorMessage = err instanceof Error ? err.message : 'Failed to fetch greeting';
            setError(errorMessage);
            console.error(`Error fetching greeting: ${errorMessage}`);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;

        fetchGreeting(signal);
        return () => controller.abort();
    }, [sessionId, agentVersion]);

    // Listen for agent switching events to refresh greeting
    useEffect(() => {
        const handleAgentSwitched = () => {
            setAgentVersion((prev) => prev + 1);
        };

        if (typeof window !== 'undefined') {
            window.addEventListener('dexto:agentSwitched', handleAgentSwitched);
            return () => {
                window.removeEventListener('dexto:agentSwitched', handleAgentSwitched);
            };
        }
    }, []);

    return { greeting, isLoading, error };
}
