import { useQuery } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Hook to fetch Dexto authentication status.
 * Returns whether dexto auth is enabled, user is authenticated, and can use dexto-nova provider.
 */
export function useDextoAuth(enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.dextoAuth.status,
        queryFn: async () => {
            const res = await client.api['dexto-auth'].status.$get();
            if (!res.ok) throw new Error('Failed to fetch dexto auth status');
            return await res.json();
        },
        enabled,
        staleTime: 30 * 1000, // 30 seconds - auth status may change
    });
}

// Export types using the standard inference pattern
export type DextoAuthStatus = NonNullable<ReturnType<typeof useDextoAuth>['data']>;
