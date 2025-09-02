'use client';

import { useState, useEffect } from 'react';
import type { GreetingResponse } from '@/types';

export function useGreeting(sessionId?: string | null) {
    const [greeting, setGreeting] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;
        const fetchGreeting = async () => {
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
                const errorMessage =
                    err instanceof Error ? err.message : 'Failed to fetch greeting';
                setError(errorMessage);
                console.error(`Error fetching greeting: ${errorMessage}`);
            } finally {
                setIsLoading(false);
            }
        };

        fetchGreeting();
        return () => controller.abort();
    }, [sessionId]);

    return { greeting, isLoading, error };
}
