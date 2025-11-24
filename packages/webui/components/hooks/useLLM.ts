import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { client } from '@/lib/client';

export function useLLMCatalog(options?: { enabled?: boolean; mode?: 'grouped' | 'flat' }) {
    const mode = options?.mode ?? 'grouped';
    return useQuery({
        queryKey: [...queryKeys.llm.catalog, mode],
        queryFn: async () => {
            const response = await client.api.llm.catalog.$get({ query: { mode } });
            return await response.json();
        },
        enabled: options?.enabled ?? true,
    });
}

export function useSwitchLLM() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: Parameters<typeof client.api.llm.switch.$post>[0]['json']) => {
            const response = await client.api.llm.switch.$post({ json: payload });
            return await response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.llm.catalog });
        },
    });
}

export function useSaveApiKey() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: Parameters<typeof client.api.llm.key.$post>[0]['json']) => {
            const response = await client.api.llm.key.$post({ json: payload });
            return await response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.llm.catalog });
        },
    });
}

// Export inferred types for components to use
export type SaveApiKeyPayload = Parameters<typeof client.api.llm.key.$post>[0]['json'];
export type LLMProvider = SaveApiKeyPayload['provider'];
export type SwitchLLMPayload = Parameters<typeof client.api.llm.switch.$post>[0]['json'];
