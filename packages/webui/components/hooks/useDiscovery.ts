import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Hook to fetch available providers and capabilities.
 * Returns blob storage providers, compression strategies, custom tool providers, and internal tools.
 */
export function useDiscovery(enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.discovery.all,
        queryFn: async () => {
            const res = await client.api.discovery.$get();
            if (!res.ok) throw new Error('Failed to fetch discovery data');
            return await res.json();
        },
        enabled,
        staleTime: 5 * 60 * 1000, // 5 minutes - providers don't change often
    });
}

// Export types using the standard inference pattern
export type DiscoveryResponse = NonNullable<ReturnType<typeof useDiscovery>['data']>;
export type DiscoveredProvider = DiscoveryResponse['blob'][number];
export type InternalToolInfo = DiscoveryResponse['internalTools'][number];
