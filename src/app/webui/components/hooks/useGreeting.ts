'use client';

import { useState, useEffect } from 'react';
import type { Greeting } from '@/types';

export function useGreeting(sessionId?: string | null) {
    const [greeting, setGreeting] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchGreeting = async () => {
            setIsLoading(true);
            setError(null);

            try {
                const url = sessionId
                    ? `/api/greeting?sessionId=${encodeURIComponent(sessionId)}`
                    : '/api/greeting';

                const response = await fetch(url);

                if (!response.ok) {
                    throw new Error(`Failed to fetch greeting: ${response.statusText}`);
                }

                const data: Greeting = await response.json();
                setGreeting(data.greeting || null);
            } catch (err) {
                const errorMessage =
                    err instanceof Error ? err.message : 'Failed to fetch greeting';
                setError(errorMessage);
                console.error('Error fetching greeting:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchGreeting();
    }, [sessionId]);

    return { greeting, isLoading, error };
}
