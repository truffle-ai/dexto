import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client.js';
import { queryKeys } from '@/lib/queryKeys.js';

async function fetchGreeting(sessionId?: string | null): Promise<string | null> {
    const data = await client.api.greeting.$get({
        query: sessionId ? { sessionId } : {},
    });
    if (!data.ok) {
        throw new Error(`Failed to fetch greeting: ${data.status}`);
    }
    const json = await data.json();
    return json.greeting ?? null;
}

// Note: Agent switch invalidation is now handled centrally in AgentSelector
export function useGreeting(sessionId?: string | null) {
    const {
        data: greeting = null,
        isLoading,
        error,
    } = useQuery({
        queryKey: queryKeys.greeting(sessionId),
        queryFn: () => fetchGreeting(sessionId),
        staleTime: 5 * 60 * 1000, // 5 minutes - greeting is static per agent
    });

    return { greeting, isLoading, error: error?.message ?? null };
}
