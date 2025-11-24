import { useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client.js';
import { queryKeys } from '@/lib/queryKeys.js';

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
