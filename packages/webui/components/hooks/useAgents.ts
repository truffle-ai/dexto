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

export function useSwitchAgent() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (
            payload: Parameters<typeof client.api.agents.switch.$post>[0]['json']
        ) => {
            const response = await client.api.agents.switch.$post({ json: payload });
            return await response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.agents.path });
        },
    });
}

export function useInstallAgent() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (
            payload: Parameters<typeof client.api.agents.install.$post>[0]['json']
        ) => {
            const response = await client.api.agents.install.$post({ json: payload });
            return await response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
        },
    });
}

export function useUninstallAgent() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (
            payload: Parameters<typeof client.api.agents.uninstall.$post>[0]['json']
        ) => {
            const response = await client.api.agents.uninstall.$post({ json: payload });
            return await response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.agents.all });
            queryClient.invalidateQueries({ queryKey: queryKeys.agents.path });
        },
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

// Export inferred types for components to use
export type CreateAgentPayload = Parameters<
    typeof client.api.agents.custom.create.$post
>[0]['json'];
