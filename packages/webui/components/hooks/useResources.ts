import { useCallback, useEffect, useState } from 'react';
import type { ResourceMetadata } from '@dexto/core';

let cachedResources: ResourceMetadata[] | null = null;
let cachedError: string | null = null;
let pendingRequest: Promise<ResourceMetadata[]> | null = null;

async function fetchResources(): Promise<ResourceMetadata[]> {
    const response = await fetch('/api/resources');
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

async function loadResources(forceRefresh = false): Promise<ResourceMetadata[]> {
    if (forceRefresh) {
        cachedResources = null;
        cachedError = null;
    }

    if (cachedResources) {
        return cachedResources;
    }

    if (!pendingRequest) {
        pendingRequest = fetchResources()
            .then((resources) => {
                cachedResources = resources;
                cachedError = null;
                return resources;
            })
            .catch((error) => {
                cachedError = error instanceof Error ? error.message : String(error);
                throw error;
            })
            .finally(() => {
                pendingRequest = null;
            });
    }

    return pendingRequest;
}

export function clearResourcesCache(): void {
    cachedResources = null;
    cachedError = null;
    pendingRequest = null;
}

export function useResources() {
    const [resources, setResources] = useState<ResourceMetadata[]>(() => cachedResources ?? []);
    const [loading, setLoading] = useState<boolean>(() => cachedResources === null);
    const [error, setError] = useState<string | null>(() => cachedError);

    useEffect(() => {
        let cancelled = false;

        loadResources()
            .then((data) => {
                if (!cancelled) {
                    setResources(data);
                    setError(null);
                    setLoading(false);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : String(err);
                    setError(message);
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const data = await loadResources(true);
            setResources(data);
            setError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
        } finally {
            setLoading(false);
        }
    }, []);

    // Listen for real-time resource cache invalidation events
    useEffect(() => {
        const handleResourceCacheInvalidated = (event: any) => {
            const detail = event?.detail || {};
            console.log('💾 Resource cache invalidated:', detail);

            // Refresh resources when cache is invalidated
            refresh();
        };

        const handleAgentSwitched = (event: any) => {
            const detail = event?.detail || {};
            console.log('🔁 Agent switched, refreshing resources:', detail);
            clearResourcesCache();
            refresh();
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
    }, [refresh]);

    return { resources, loading, error, refresh } as const;
}
