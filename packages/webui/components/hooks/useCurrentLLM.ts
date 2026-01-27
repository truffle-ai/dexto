import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { client } from '@/lib/client';

/**
 * Hook to fetch the current LLM configuration for a session
 * Centralized access point for currentLLM data
 */
export function useCurrentLLM(sessionId: string | null, enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.llm.current(sessionId),
        queryFn: async () => {
            const response = await client.api.llm.current.$get({
                query: sessionId ? { sessionId } : {},
            });
            if (!response.ok) {
                throw new Error('Failed to fetch current LLM config');
            }
            const data = await response.json();
            const cfg = data.config || data;
            return {
                provider: cfg.provider,
                model: cfg.model,
                displayName: cfg.displayName,
                baseURL: cfg.baseURL,
                viaDexto: data.routing?.viaDexto ?? false,
            };
        },
        // Always enabled - API returns default config when no sessionId
        // This ensures the model name shows on welcome screen
        enabled,
        retry: false, // Don't retry on error - UI can still operate
    });
}

// Export type for components to use
export type CurrentLLM = NonNullable<ReturnType<typeof useCurrentLLM>['data']>;
