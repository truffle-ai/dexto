import { useState, useEffect, useRef, useCallback } from 'react';
import { serverRegistry } from '@/lib/serverRegistry';
import type { ServerRegistryEntry, ServerRegistryFilter } from '@/types';

interface UseServerRegistryOptions {
    autoLoad?: boolean;
    initialFilter?: ServerRegistryFilter;
}

export function useServerRegistry(options: UseServerRegistryOptions = {}) {
    const { autoLoad = true, initialFilter } = options;

    const [entries, setEntries] = useState<ServerRegistryEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<ServerRegistryFilter>(initialFilter || {});

    // Track if component is mounted to prevent state updates after unmount
    const isMountedRef = useRef(true);
    const abortControllerRef = useRef<AbortController | null>(null);

    const loadEntries = useCallback(
        async (newFilter?: ServerRegistryFilter) => {
            // Cancel any ongoing request
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }

            // Create new AbortController for this request
            const abortController = new AbortController();
            abortControllerRef.current = abortController;

            // Only update state if component is still mounted
            if (!isMountedRef.current) return;

            setIsLoading(true);
            setError(null);

            try {
                const filterToUse = newFilter || filter;
                const registryEntries = await serverRegistry.getEntries(filterToUse);

                // Check if component is still mounted and request wasn't aborted
                if (isMountedRef.current && !abortController.signal.aborted) {
                    setEntries(registryEntries);
                }
            } catch (err: unknown) {
                // Only set error if component is still mounted and request wasn't aborted
                if (isMountedRef.current && !abortController.signal.aborted) {
                    const errorMessage =
                        err instanceof Error ? err.message : 'Failed to load server registry';
                    setError(errorMessage);
                }
            } finally {
                // Only update loading state if component is still mounted and request wasn't aborted
                if (isMountedRef.current && !abortController.signal.aborted) {
                    setIsLoading(false);
                }
            }
        },
        [filter]
    );

    const updateFilter = (newFilter: ServerRegistryFilter) => {
        if (isMountedRef.current) {
            setFilter(newFilter);
        }
    };

    useEffect(() => {
        if (isMountedRef.current) {
            loadEntries();
        }
    }, [filter, loadEntries]);

    const markAsInstalled = async (entryId: string) => {
        if (!isMountedRef.current) return;

        try {
            await serverRegistry.setInstalled(entryId, true);
            if (isMountedRef.current) {
                setEntries((prev) =>
                    prev.map((entry) =>
                        entry.id === entryId ? { ...entry, isInstalled: true } : entry
                    )
                );
            }
        } catch (err: unknown) {
            if (isMountedRef.current) {
                const errorMessage =
                    err instanceof Error ? err.message : 'Failed to mark server as installed';
                setError(errorMessage);
            }
        }
    };

    const addCustomEntry = async (
        entry: Omit<ServerRegistryEntry, 'id' | 'isOfficial' | 'lastUpdated'>
    ) => {
        if (!isMountedRef.current) return;

        try {
            const newEntry = await serverRegistry.addCustomEntry(entry);
            if (isMountedRef.current) {
                setEntries((prev) => [newEntry, ...prev]);
            }
            return newEntry;
        } catch (err: unknown) {
            if (isMountedRef.current) {
                const errorMessage =
                    err instanceof Error ? err.message : 'Failed to add custom server';
                setError(errorMessage);
            }
            throw err;
        }
    };

    useEffect(() => {
        if (autoLoad && isMountedRef.current) {
            loadEntries();
        }
    }, [autoLoad, loadEntries]);

    // Cleanup effect to handle unmounting
    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            // Abort any ongoing requests
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    return {
        entries,
        isLoading,
        error,
        filter,
        loadEntries,
        updateFilter,
        markAsInstalled,
        addCustomEntry,
        clearError: () => {
            if (isMountedRef.current) {
                setError(null);
            }
        },
    };
}
