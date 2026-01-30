import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { serverRegistry } from '@/lib/serverRegistry';
import type { ServerRegistryEntry, ServerRegistryFilter } from '@dexto/registry';
import { queryKeys } from '@/lib/queryKeys.js';

interface UseServerRegistryOptions {
    autoLoad?: boolean;
    initialFilter?: ServerRegistryFilter;
}

export function useServerRegistry(options: UseServerRegistryOptions = {}) {
    const { autoLoad = true, initialFilter } = options;
    const queryClient = useQueryClient();

    const [filter, setFilter] = useState<ServerRegistryFilter>(initialFilter || {});

    const {
        data: entries = [],
        isLoading,
        error,
    } = useQuery({
        queryKey: queryKeys.serverRegistry(filter),
        queryFn: () => serverRegistry.getEntries(filter),
        enabled: autoLoad,
    });

    const markAsInstalledMutation = useMutation({
        mutationFn: async (entryId: string) => {
            await serverRegistry.setInstalled(entryId, true);
            return entryId;
        },
        onSuccess: (entryId) => {
            // Optimistically update the cache
            queryClient.setQueryData<ServerRegistryEntry[]>(
                queryKeys.serverRegistry(filter),
                (old) =>
                    old?.map((entry) =>
                        entry.id === entryId ? { ...entry, isInstalled: true } : entry
                    ) ?? []
            );
        },
    });

    const updateFilter = (newFilter: ServerRegistryFilter) => {
        setFilter(newFilter);
    };

    const loadEntries = async (newFilter?: ServerRegistryFilter) => {
        if (newFilter) {
            setFilter(newFilter);
        } else {
            // Trigger a refetch with current filter
            await queryClient.refetchQueries({ queryKey: queryKeys.serverRegistry(filter) });
        }
    };

    const markAsInstalled = async (entryId: string) => {
        await markAsInstalledMutation.mutateAsync(entryId);
    };

    return {
        entries,
        isLoading,
        error: error?.message ?? null,
        filter,
        loadEntries,
        updateFilter,
        markAsInstalled,
        clearError: () => {
            // Errors are automatically cleared when query succeeds
        },
    };
}
