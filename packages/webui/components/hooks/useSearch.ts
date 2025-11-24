import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client.js';
import { queryKeys } from '@/lib/queryKeys.js';

// Type inference helpers - extract types from server response
type MessageSearchResponseType =
    Awaited<ReturnType<typeof client.api.search.messages.$get>> extends {
        json: () => Promise<infer T>;
    }
        ? T
        : never;

type SessionSearchResponseType =
    Awaited<ReturnType<typeof client.api.search.sessions.$get>> extends {
        json: () => Promise<infer T>;
    }
        ? T
        : never;

export type SearchResult = MessageSearchResponseType extends { results: Array<infer R> }
    ? R
    : never;
export type SessionSearchResult = SessionSearchResponseType extends { results: Array<infer R> }
    ? R
    : never;

// Search messages
export function useSearchMessages(
    query: string,
    sessionId?: string,
    limit: number = 50,
    enabled: boolean = true
) {
    return useQuery({
        queryKey: queryKeys.search.messages(query, sessionId, limit),
        queryFn: async () => {
            const response = await client.api.search.messages.$get({
                query: {
                    q: query,
                    limit: limit,
                    ...(sessionId && { sessionId }),
                },
            });
            return await response.json();
        },
        enabled: enabled && query.trim().length > 0,
        staleTime: 30000, // 30 seconds
    });
}

// Search sessions
export function useSearchSessions(query: string, limit: number = 20, enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.search.sessions(query, limit),
        queryFn: async () => {
            const response = await client.api.search.sessions.$get({
                query: { q: query },
            });
            return await response.json();
        },
        enabled: enabled && query.trim().length > 0,
        staleTime: 30000, // 30 seconds
    });
}
