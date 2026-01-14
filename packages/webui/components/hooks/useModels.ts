/**
 * Hooks for local GGUF and Ollama model management.
 *
 * These hooks expose model discovery that was previously only available in CLI.
 * Used by the model picker to display installed local models and Ollama models.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { client } from '@/lib/client';

/**
 * Fetch installed local GGUF models from state.json.
 * These are models downloaded via CLI or manually registered.
 */
export function useLocalModels(options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: queryKeys.models.local,
        queryFn: async () => {
            const response = await client.api.models.local.$get();
            if (!response.ok) {
                throw new Error(`Failed to fetch local models: ${response.status}`);
            }
            return await response.json();
        },
        enabled: options?.enabled ?? true,
        staleTime: 30 * 1000, // 30 seconds - models don't change often
    });
}

/**
 * Fetch available Ollama models from the Ollama server.
 * Returns empty list with available=false if Ollama is not running.
 */
export function useOllamaModels(options?: { enabled?: boolean; baseURL?: string }) {
    return useQuery({
        queryKey: queryKeys.models.ollama(options?.baseURL),
        queryFn: async () => {
            const response = await client.api.models.ollama.$get({
                query: options?.baseURL ? { baseURL: options.baseURL } : {},
            });
            if (!response.ok) {
                throw new Error(`Failed to fetch Ollama models: ${response.status}`);
            }
            return await response.json();
        },
        enabled: options?.enabled ?? true,
        staleTime: 30 * 1000, // 30 seconds
        retry: false, // Don't retry if Ollama not running
    });
}

/**
 * Validate a local GGUF file path.
 * Used by the custom model form to validate file paths before saving.
 */
export function useValidateLocalFile() {
    return useMutation({
        mutationFn: async (filePath: string) => {
            const response = await client.api.models.local.validate.$post({
                json: { filePath },
            });
            if (!response.ok) {
                throw new Error(`Failed to validate file: ${response.status}`);
            }
            return await response.json();
        },
    });
}

/**
 * Delete an installed local model.
 * Removes from state.json and optionally deletes the GGUF file from disk.
 */
export function useDeleteInstalledModel() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            modelId,
            deleteFile = true,
        }: {
            modelId: string;
            deleteFile?: boolean;
        }) => {
            const response = await client.api.models.local[':modelId'].$delete({
                param: { modelId },
                json: { deleteFile },
            });
            if (!response.ok) {
                let errorMessage = `Failed to delete model: ${response.status}`;
                try {
                    const data = await response.json();
                    if (data.error) errorMessage = data.error;
                } catch {
                    // Response body not JSON-parseable (e.g., network error, proxy error), use default message
                }
                throw new Error(errorMessage);
            }
            return await response.json();
        },
        onSuccess: () => {
            // Invalidate local models cache to refresh the list
            queryClient.invalidateQueries({ queryKey: queryKeys.models.local });
        },
    });
}

// Export inferred types for components to use
export type LocalModel = NonNullable<ReturnType<typeof useLocalModels>['data']>['models'][number];
export type OllamaModel = NonNullable<ReturnType<typeof useOllamaModels>['data']>['models'][number];
export type ValidateLocalFileResult = Awaited<
    ReturnType<ReturnType<typeof useValidateLocalFile>['mutateAsync']>
>;
