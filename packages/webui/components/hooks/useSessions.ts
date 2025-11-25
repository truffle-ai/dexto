import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client.js';
import { queryKeys } from '@/lib/queryKeys.js';

// List all sessions
export function useSessions(enabled: boolean = true) {
    return useQuery({
        queryKey: queryKeys.sessions.all,
        queryFn: async () => {
            const response = await client.api.sessions.$get();
            const data = await response.json();
            return data.sessions;
        },
        enabled,
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
