import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client.js';
import { queryKeys } from '@/lib/queryKeys.js';

// List all sessions
export function useSessions(enabled: boolean = true) {
    const queryClient = useQueryClient();

    // Invalidate sessions cache when agent is switched (each agent has different sessions)
    useEffect(() => {
        const handleAgentSwitched = () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
        };

        if (typeof window !== 'undefined') {
            window.addEventListener('dexto:agentSwitched', handleAgentSwitched);
            return () => {
                window.removeEventListener('dexto:agentSwitched', handleAgentSwitched);
            };
        }
    }, [queryClient]);

    return useQuery({
        queryKey: queryKeys.sessions.all,
        queryFn: async () => {
            const response = await client.api.sessions.$get();
            const data = await response.json();
            return data.sessions;
        },
        enabled,
        staleTime: 30 * 1000, // 30 seconds - sessions can be created frequently
    });
}

// Create a new session
export function useCreateSession() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ sessionId }: { sessionId?: string }) => {
            const response = await client.api.sessions.$post({
                json: { sessionId: sessionId?.trim() || undefined },
            });
            const data = await response.json();
            return data.session;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
        },
    });
}

// Delete a session
export function useDeleteSession() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ sessionId }: { sessionId: string }) => {
            await client.api.sessions[':sessionId'].$delete({
                param: { sessionId },
            });
        },
        onSuccess: () => {
            // Invalidate sessions list to refresh after deletion
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
        },
    });
}

// Rename a session (update title)
export function useRenameSession() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ sessionId, title }: { sessionId: string; title: string }) => {
            const response = await client.api.sessions[':sessionId'].$patch({
                param: { sessionId },
                json: { title },
            });
            if (!response.ok) {
                throw new Error('Failed to rename session');
            }
            const data = await response.json();
            return data.session;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
        },
    });
}

// Export inferred types for components to use
export type Session = NonNullable<ReturnType<typeof useSessions>['data']>[number];
