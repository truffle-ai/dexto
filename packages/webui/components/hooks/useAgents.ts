import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { client } from '@/lib/client';

export function useAgents() {
    return useQuery({
        queryKey: queryKeys.agents.all,
        queryFn: async () => {
            const response = await client.api.agents.$get();
            return await response.json();
        },
    });
}

export function useAgentPath() {
    return useQuery({
        queryKey: queryKeys.agents.path,
        queryFn: async () => {
            const response = await client.api.agent.path.$get();
            return await response.json();
        },
        retry: false,
    });
}

export function useCreateAgent() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (
            payload: Parameters<typeof client.api.agents.custom.create.$post>[0]['json']
        ) => {
            const response = await client.api.agents.custom.create.$post({ json: payload });
            return await response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
        },
    });
}
