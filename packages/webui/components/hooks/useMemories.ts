import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { client } from '@/lib/client';

export function useMemories(enabled: boolean = true) {
    const queryClient = useQueryClient();

    // Invalidate memories cache when agent is switched (each agent has different memories)
    useEffect(() => {
        const handleAgentSwitched = () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.memories.all });
        };

        if (typeof window !== 'undefined') {
            window.addEventListener('dexto:agentSwitched', handleAgentSwitched);
            return () => {
                window.removeEventListener('dexto:agentSwitched', handleAgentSwitched);
            };
        }
    }, [queryClient]);

    return useQuery({
        queryKey: queryKeys.memories.all,
        queryFn: async () => {
            const response = await client.api.memory.$get({ query: {} });
            if (!response.ok) {
                throw new Error(`Failed to fetch memories: ${response.status}`);
            }
            const data = await response.json();
            return data.memories;
        },
        enabled,
        staleTime: 30 * 1000, // 30 seconds - memories can be added during chat
    });
}

export function useDeleteMemory() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ memoryId }: { memoryId: string }) => {
            const response = await client.api.memory[':id'].$delete({ param: { id: memoryId } });
            if (!response.ok) {
                throw new Error(`Failed to delete memory: ${response.status}`);
            }
            return memoryId;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.memories.all });
        },
    });
}

export function useCreateMemory() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: {
            content: string;
            tags?: string[];
            metadata?: { source: string; [key: string]: unknown };
        }) => {
            const response = await client.api.memory.$post({ json: payload });
            if (!response.ok) {
                throw new Error(`Failed to create memory: ${response.status}`);
            }
            return await response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.memories.all });
        },
    });
}

// Export inferred types for components to use
export type Memory = NonNullable<ReturnType<typeof useMemories>['data']>[number];
