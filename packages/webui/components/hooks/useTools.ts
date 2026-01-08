import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';

export function useAllTools(enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.tools.all,
        queryFn: async () => {
            const res = await client.api.tools.$get();
            if (!res.ok) throw new Error('Failed to fetch tools');
            return await res.json();
        },
        enabled,
    });
}

// Export types using the standard inference pattern
export type AllToolsResponse = NonNullable<ReturnType<typeof useAllTools>['data']>;
export type ToolInfo = AllToolsResponse['tools'][number];
