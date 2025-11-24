import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { client } from '@/lib/client';

export function useMemories(enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.memories.all,
        queryFn: async () => {
            const response = await client.api.memory.$get({ query: {} });
            const data = await response.json();
            return data.memories;
        },
        enabled,
    });
}

export function useDeleteMemory() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ memoryId }: { memoryId: string }) => {
            await client.api.memory[':id'].$delete({ param: { id: memoryId } });
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
            return await response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.memories.all });
        },
    });
}

// Export inferred types for components to use
export type Memory = NonNullable<ReturnType<typeof useMemories>['data']>[number];
