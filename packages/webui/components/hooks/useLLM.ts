import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { client } from '@/lib/client';

export function useLLMCatalog(options?: { enabled?: boolean; mode?: 'grouped' | 'flat' }) {
    const mode = options?.mode ?? 'grouped';
    return useQuery({
        queryKey: [...queryKeys.llm.catalog, mode],
        queryFn: async () => {
            const response = await client.api.llm.catalog.$get({ query: { mode } });
            if (!response.ok) {
                throw new Error(`Failed to fetch LLM catalog: ${response.status}`);
            }
            return await response.json();
        },
        enabled: options?.enabled ?? true,
        staleTime: 5 * 60 * 1000, // 5 minutes - catalog rarely changes
    });
}

export function useSwitchLLM() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: SwitchLLMPayload) => {
            const response = await client.api.llm.switch.$post({ json: payload });
            if (!response.ok) {
                throw new Error(`Failed to switch LLM: ${response.status}`);
            }
            return await response.json();
        },
        onSuccess: () => {
            // Invalidate catalog and all current LLM queries to refresh all views
            queryClient.invalidateQueries({ queryKey: queryKeys.llm.catalog });
            queryClient.invalidateQueries({ queryKey: ['llm', 'current'] });
        },
    });
}

export function useProviderApiKey(provider: LLMProvider | null, options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: [...queryKeys.llm.catalog, 'key', provider],
        queryFn: async () => {
            if (!provider) return null;
            const response = await client.api.llm.key[':provider'].$get({
                param: { provider },
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch API key: ${response.status}`);
            }
            return await response.json();
        },
        enabled: (options?.enabled ?? true) && !!provider,
        staleTime: 30 * 1000, // 30 seconds
    });
}

export function useSaveApiKey() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: SaveApiKeyPayload) => {
            const response = await client.api.llm.key.$post({ json: payload });
            if (!response.ok) {
                throw new Error(`Failed to save API key: ${response.status}`);
            }
            return await response.json();
        },
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({ queryKey: queryKeys.llm.catalog });
            // Also invalidate the specific provider key query
            queryClient.invalidateQueries({
                queryKey: [...queryKeys.llm.catalog, 'key', variables.provider],
            });
        },
    });
}

// Custom models hooks
export function useCustomModels(options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: queryKeys.llm.customModels,
        queryFn: async () => {
            const response = await client.api.llm['custom-models'].$get();
            if (!response.ok) {
                throw new Error(`Failed to fetch custom models: ${response.status}`);
            }
            const data = await response.json();
            return data.models;
        },
        enabled: options?.enabled ?? true,
        staleTime: 60 * 1000, // 1 minute
    });
}

export function useCreateCustomModel() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: CustomModelPayload) => {
            const response = await client.api.llm['custom-models'].$post({ json: payload });
            if (!response.ok) {
                throw new Error(`Failed to create custom model: ${response.status}`);
            }
            return await response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.llm.customModels });
        },
    });
}

export function useDeleteCustomModel() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (name: string) => {
            // URL-encode the name to handle OpenRouter model IDs with slashes (e.g., anthropic/claude-3.5-sonnet)
            const encodedName = encodeURIComponent(name);
            const response = await client.api.llm['custom-models'][':name'].$delete({
                param: { name: encodedName },
            });
            if (!response.ok) {
                throw new Error(`Failed to delete custom model: ${response.status}`);
            }
            return await response.json();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.llm.customModels });
        },
    });
}

// Model capabilities hook - resolves gateway providers to underlying model capabilities
export function useModelCapabilities(
    provider: LLMProvider | null | undefined,
    model: string | null | undefined,
    options?: { enabled?: boolean }
) {
    return useQuery({
        queryKey: [...queryKeys.llm.catalog, 'capabilities', provider, model],
        queryFn: async () => {
            if (!provider || !model) return null;
            const response = await client.api.llm.capabilities.$get({
                query: { provider, model },
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch model capabilities: ${response.status}`);
            }
            return await response.json();
        },
        enabled: (options?.enabled ?? true) && !!provider && !!model,
        staleTime: 5 * 60 * 1000, // 5 minutes - capabilities rarely change
    });
}

// Export inferred types for components to use
export type SaveApiKeyPayload = Parameters<typeof client.api.llm.key.$post>[0]['json'];
export type LLMProvider = SaveApiKeyPayload['provider'];
export type SwitchLLMPayload = Parameters<typeof client.api.llm.switch.$post>[0]['json'];

// Helper to extract the custom-models endpoint (Prettier can't parse hyphenated bracket notation in Parameters<>)
type CustomModelsEndpoint = (typeof client.api.llm)['custom-models'];
export type CustomModelPayload = Parameters<CustomModelsEndpoint['$post']>[0]['json'];
export type CustomModel = NonNullable<ReturnType<typeof useCustomModels>['data']>[number];
