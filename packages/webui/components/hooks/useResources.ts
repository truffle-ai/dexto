import { useEffect, useState } from 'react';

export type ResourceMetadata = {
    uri: string;
    name?: string;
    description?: string;
    mimeType?: string;
    source: 'mcp' | 'plugin' | 'custom';
    serverName?: string;
    size?: number;
    lastModified?: string | Date;
    metadata?: Record<string, unknown>;
};

export function useResources() {
    const [resources, setResources] = useState<ResourceMetadata[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch('/api/resources');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (data.ok && Array.isArray(data.resources)) {
                    if (mounted) setResources(data.resources);
                } else {
                    throw new Error('Invalid response shape');
                }
            } catch (e) {
                if (mounted) setError(e instanceof Error ? e.message : 'Failed to fetch resources');
                // Do not throw; leave UI functional without resources.
            } finally {
                if (mounted) setLoading(false);
            }
        };
        load();
        return () => {
            mounted = false;
        };
    }, []);

    return { resources, loading, error } as const;
}
