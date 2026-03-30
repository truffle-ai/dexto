/**
 * Hooks for local GGUF and Ollama model management.
 *
 * These hooks expose model discovery that was previously only available in CLI.
 * Used by the model picker to display installed local models and Ollama models.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { client } from '@/lib/client';
import { parseApiResponse } from '@/lib/api-errors';

/**
 * Fetch installed local GGUF models from state.json.
 * These are models downloaded via CLI or manually registered.
 */
export function useLocalModels(options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: queryKeys.models.local,
        queryFn: async () => {
            return await parseApiResponse(
                client.api.models.local.$get(),
                'Failed to fetch local models'
            );
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
            return await parseApiResponse(
                client.api.models.ollama.$get({
                    query: options?.baseURL ? { baseURL: options.baseURL } : {},
                }),
                'Failed to fetch Ollama models'
            );
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
            return await parseApiResponse(
                client.api.models.local.validate.$post({
                    json: { filePath },
                }),
                'Failed to validate local model file'
            );
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
            return await parseApiResponse(
                client.api.models.local[':modelId'].$delete({
                    param: { modelId },
                    json: { deleteFile },
                }),
                'Failed to delete model'
            );
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
