import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client.js';
import { parseApiResponse } from '@/lib/api-errors.js';
import { queryKeys } from '@/lib/queryKeys.js';

async function fetchResources() {
    const data = await parseApiResponse(client.api.resources.$get(), 'Failed to load resources');
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
