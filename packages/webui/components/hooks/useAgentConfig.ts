import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client.js';
import { parseApiResponse } from '@/lib/api-errors.js';
import { queryKeys } from '@/lib/queryKeys.js';

// Fetch agent configuration
export function useAgentConfig(enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.agent.config,
        queryFn: async () => {
            return await parseApiResponse(
                client.api.agent.config.$get(),
                'Failed to load agent config'
            );
        },
        enabled,
        staleTime: 30000, // 30 seconds
    });
}

// Validate agent configuration
export function useValidateAgent() {
    return useMutation({
        mutationFn: async ({ yaml }: { yaml: string }) => {
            return await parseApiResponse(
                client.api.agent.validate.$post({
                    json: { yaml },
                }),
                'Failed to validate agent config'
            );
        },
    });
}

// Export types inferred from hook return values
export type ValidationError = NonNullable<
    ReturnType<typeof useValidateAgent>['data']
>['errors'][number];
export type ValidationWarning = NonNullable<
    ReturnType<typeof useValidateAgent>['data']
>['warnings'][number];

// Save agent configuration
export function useSaveAgentConfig() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ yaml }: { yaml: string }) => {
            return await parseApiResponse(
                client.api.agent.config.$post({
                    json: { yaml },
                }),
                'Failed to save agent config'
            );
        },
        onSuccess: () => {
            // Invalidate agent config to refresh after save
            queryClient.invalidateQueries({ queryKey: queryKeys.agent.config });
        },
    });
}
