import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client.js';
import { queryKeys } from '@/lib/queryKeys.js';

// Type inference helpers - extract types from server response
type ValidationResponseType =
    Awaited<ReturnType<typeof client.api.agent.validate.$post>> extends {
        json: () => Promise<infer T>;
    }
        ? T
        : never;

export type ValidationError = ValidationResponseType extends { errors: Array<infer E> } ? E : never;
export type ValidationWarning = ValidationResponseType extends { warnings: Array<infer W> }
    ? W
    : never;

// Fetch agent configuration
export function useAgentConfig(enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.agent.config,
        queryFn: async () => {
            const response = await client.api.agent.config.$get();
            return await response.json();
        },
        enabled,
        staleTime: 30000, // 30 seconds
    });
}

// Validate agent configuration
export function useValidateAgent() {
    return useMutation({
        mutationFn: async ({ yaml }: { yaml: string }) => {
            const response = await client.api.agent.validate.$post({
                json: { yaml },
            });
            return await response.json();
        },
    });
}

// Save agent configuration
export function useSaveAgentConfig() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ yaml }: { yaml: string }) => {
            const response = await client.api.agent.config.$post({
                json: { yaml },
            });
            return await response.json();
        },
        onSuccess: () => {
            // Invalidate agent config to refresh after save
            queryClient.invalidateQueries({ queryKey: queryKeys.agent.config });
        },
    });
}
