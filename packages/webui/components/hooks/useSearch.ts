import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client.js';
import { queryKeys } from '@/lib/queryKeys.js';

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
export function useSearchSessions(query: string, enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.search.sessions(query),
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

// Export types inferred from hook return values
export type SearchResult = NonNullable<
    ReturnType<typeof useSearchMessages>['data']
>['results'][number];
export type SessionSearchResult = NonNullable<
    ReturnType<typeof useSearchSessions>['data']
>['results'][number];
