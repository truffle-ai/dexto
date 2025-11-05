import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client.js';
import { queryKeys } from '@/lib/queryKeys.js';

// Delete a session
export function useDeleteSession() {
    const queryClient = useQueryClient();

    return useMutation<void, Error, { sessionId: string }>({
        mutationFn: async ({ sessionId }) => {
            await apiFetch(`/api/sessions/${sessionId}`, {
                method: 'DELETE',
            });
        },
        onSuccess: () => {
            // Invalidate sessions list to refresh after deletion
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions.all });
        },
    });
}
