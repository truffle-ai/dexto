import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client.js';
import { queryKeys } from '@/lib/queryKeys.js';

interface SearchMessage {
    sessionId: string;
    role: string;
    content: string;
    timestamp: number;
    preview?: string;
}

interface SearchSession {
    sessionId: string;
    title?: string;
    lastActivity: string;
    messageCount: number;
    preview?: string;
}

interface MessageSearchResponse {
    results: SearchMessage[];
    total: number;
}

interface SessionSearchResponse {
    results: SearchSession[];
    total: number;
}

// Search messages
export function useSearchMessages(
    query: string,
    sessionId?: string,
    limit: number = 50,
    enabled: boolean = true
) {
    return useQuery<MessageSearchResponse, Error>({
        queryKey: queryKeys.search.messages(query, sessionId, limit),
        queryFn: async () => {
            const params = new URLSearchParams({ q: query, limit: limit.toString() });
            if (sessionId) params.append('sessionId', sessionId);

            const data = await apiFetch<MessageSearchResponse>(`/api/search/messages?${params}`);
            return data;
        },
        enabled: enabled && query.trim().length > 0,
        staleTime: 30000, // 30 seconds
    });
}

// Search sessions
export function useSearchSessions(query: string, limit: number = 20, enabled: boolean = true) {
    return useQuery<SessionSearchResponse, Error>({
        queryKey: queryKeys.search.sessions(query, limit),
        queryFn: async () => {
            const params = new URLSearchParams({ q: query, limit: limit.toString() });
            const data = await apiFetch<SessionSearchResponse>(`/api/search/sessions?${params}`);
            return data;
        },
        enabled: enabled && query.trim().length > 0,
        staleTime: 30000, // 30 seconds
    });
}
