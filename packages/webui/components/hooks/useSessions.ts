import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client.js';
import { queryKeys } from '@/lib/queryKeys.js';

// List all sessions
// Note: Agent switch invalidation is now handled centrally in AgentSelector
export function useSessions(enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.sessions.all,
        queryFn: async () => {
            const response = await client.api.sessions.$get();
            if (!response.ok) {
                throw new Error(`Failed to fetch sessions: ${response.status}`);
            }
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
            if (!response.ok) {
                throw new Error(`Failed to create session: ${response.status}`);
            }
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
            const response = await client.api.sessions[':sessionId'].$delete({
                param: { sessionId },
            });
            if (!response.ok) {
                throw new Error(`Failed to delete session: ${response.status}`);
            }
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
