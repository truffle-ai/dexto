'use client';
import { useState, useEffect } from 'react';

export interface ResourceMetadata {
    uri: string;
    name?: string;
    description?: string;
    mimeType?: string;
    source: 'mcp' | 'custom';
    serverName?: string;
    size?: number;
    lastModified?: string;
    metadata?: Record<string, unknown>;
}

interface ResourcesResponse {
    ok: boolean;
    resources: ResourceMetadata[];
}

export function useResources() {
    const [resources, setResources] = useState<ResourceMetadata[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchResources = async () => {
        if (isLoading) return; // Prevent concurrent requests

        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/resources');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data: ResourcesResponse = await response.json();

            if (data.ok && Array.isArray(data.resources)) {
                setResources(data.resources);
            } else {
                throw new Error('Invalid response format');
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to fetch resources';
            setError(errorMessage);
            console.error('Failed to fetch resources:', err);
        } finally {
            setIsLoading(false);
        }
    };

    // Auto-fetch resources on mount
    useEffect(() => {
        fetchResources();
    }, []);

    const refresh = () => {
        fetchResources();
    };

    return {
        resources,
        isLoading,
        error,
        refresh,
    };
}
