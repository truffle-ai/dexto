import { useState, useEffect, useCallback } from 'react';
import type {
    ApiResponse,
    HealthStatus,
    PaginatedTraces,
    Trace,
    Metrics,
    SessionMetrics,
    TraceFilters,
} from './types';

const API_URL = '/api';

// Generic fetch hook
function useFetch<T>(url: string | null, options?: RequestInit) {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetchData = useCallback(async () => {
        if (!url) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            setError(null);

            const response = await fetch(url, options);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const json = await response.json();
            setData(json);
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Unknown error'));
        } finally {
            setLoading(false);
        }
    }, [url, JSON.stringify(options)]);

    useEffect(() => {
        void fetchData();
    }, [fetchData]);

    return { data, loading, error, refetch: fetchData };
}

// Health status hook
export function useHealth() {
    return useFetch<ApiResponse<HealthStatus>>(`${API_URL}/health`);
}

// Traces hook with filtering
export function useTraces(filters?: TraceFilters & { page?: number; pageSize?: number }) {
    const queryParams = new URLSearchParams();

    if (filters) {
        Object.entries(filters).forEach(([key, value]) => {
            if (value !== undefined && value !== '') {
                queryParams.set(key, String(value));
            }
        });
    }

    const url = `${API_URL}/traces${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    return useFetch<ApiResponse<PaginatedTraces>>(url);
}

// Single trace hook
export function useTrace(traceId: string | null) {
    const url = traceId ? `${API_URL}/traces/${traceId}` : null;
    return useFetch<ApiResponse<Trace>>(url);
}

// Metrics hook
export function useMetrics(options?: { window?: string; sessionId?: string; provider?: string }) {
    const queryParams = new URLSearchParams();

    if (options) {
        Object.entries(options).forEach(([key, value]) => {
            if (value !== undefined && value !== '') {
                queryParams.set(key, value);
            }
        });
    }

    const url = `${API_URL}/metrics${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
    return useFetch<ApiResponse<Metrics>>(url);
}

// Session metrics hook
export function useSessionMetrics(sessionId: string | null) {
    const url = sessionId ? `${API_URL}/sessions/${sessionId}` : null;
    return useFetch<ApiResponse<SessionMetrics>>(url);
}

// Auto-refresh hook
export function useAutoRefresh(callback: () => void, interval: number = 10000) {
    useEffect(() => {
        const id = setInterval(callback, interval);
        return () => clearInterval(id);
    }, [callback, interval]);
}
