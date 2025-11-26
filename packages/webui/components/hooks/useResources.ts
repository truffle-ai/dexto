import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client.js';
import { queryKeys } from '@/lib/queryKeys.js';

async function fetchResources() {
    const response = await client.api.resources.$get();
    const data = await response.json();
    if (!data.ok || !Array.isArray(data.resources)) {
        throw new Error('Invalid response shape');
    }
    return data.resources;
}

export function useResources() {
    const {
        data: resources = [],
        isLoading: loading,
        error,
        refetch: refresh,
    } = useQuery({
        queryKey: queryKeys.resources.all,
        queryFn: fetchResources,
        staleTime: 60 * 1000, // 1 minute - resources can change when servers connect/disconnect
    });

    return {
        resources,
        loading,
        error: error?.message ?? null,
        refresh: async () => {
            await refresh();
        },
    } as const;
}
