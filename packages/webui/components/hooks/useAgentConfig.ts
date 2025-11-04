import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client.js';
import { queryKeys } from '@/lib/queryKeys.js';

export interface ValidationError {
    line?: number;
    column?: number;
    path?: string;
    message: string;
    code: string;
}

export interface ValidationWarning {
    path: string;
    message: string;
    code: string;
}

interface AgentConfigResponse {
    yaml: string;
    path: string;
    relativePath: string;
    lastModified: string;
    warnings: string[];
}

interface ValidationResponse {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationWarning[];
}

interface SaveConfigResponse {
    ok: boolean;
    path: string;
    reloaded: boolean;
    restarted: boolean;
    changesApplied: string[];
    message: string;
}

// Fetch agent configuration
export function useAgentConfig(enabled: boolean = true) {
    return useQuery<AgentConfigResponse, Error>({
        queryKey: queryKeys.agent.config,
        queryFn: async () => {
            const data = await apiFetch<AgentConfigResponse>('/api/agent/config');
            return data;
        },
        enabled,
        staleTime: 30000, // 30 seconds
    });
}

// Validate agent configuration
export function useValidateAgent() {
    return useMutation<ValidationResponse, Error, { yaml: string }>({
        mutationFn: async ({ yaml }) => {
            const data = await apiFetch<ValidationResponse>('/api/agent/validate', {
                method: 'POST',
                body: JSON.stringify({ yaml }),
            });
            return data;
        },
    });
}

// Save agent configuration
export function useSaveAgentConfig() {
    const queryClient = useQueryClient();

    return useMutation<SaveConfigResponse, Error, { yaml: string }>({
        mutationFn: async ({ yaml }) => {
            const data = await apiFetch<SaveConfigResponse>('/api/agent/config', {
                method: 'POST',
                body: JSON.stringify({ yaml }),
            });
            return data;
        },
        onSuccess: () => {
            // Invalidate agent config to refresh after save
            queryClient.invalidateQueries({ queryKey: queryKeys.agent.config });
        },
    });
}
