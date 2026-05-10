import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';
import type { Attachment } from '../../lib/attachment-types.js';
import { resolveMessageContent } from '../../lib/attachment-utils.js';

/**
 * Hook to fetch queued follow-up messages for a session
 */
export function useFollowUpMessages(sessionId: string | null) {
    return useQuery({
        queryKey: queryKeys.followUp.list(sessionId ?? ''),
        queryFn: async () => {
            if (!sessionId) return { messages: [], count: 0 };
            const response = await client.api['follow-up'][':sessionId'].$get({
                param: { sessionId },
            });
            if (!response.ok) {
                throw new Error('Failed to fetch follow-up messages');
            }
            return await response.json();
        },
        enabled: !!sessionId,
        // Refetch frequently while processing to show follow-up updates
        refetchInterval: (query) => ((query.state.data?.count ?? 0) > 0 ? 2000 : false),
    });
}

// Export type for queued follow-up message
export type QueuedMessage = NonNullable<
    ReturnType<typeof useFollowUpMessages>['data']
>['messages'][number];

/**
 * Hook to queue a new follow-up message
 */
export function useQueueFollowUpMessage() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            sessionId,
            message,
            attachments,
        }: {
            sessionId: string;
            message?: string;
            attachments?: Attachment[];
        }) => {
            const response = await client.api['follow-up'][':sessionId'].$post({
                param: { sessionId },
                json: {
                    content: resolveMessageContent(message, attachments),
                },
            });
            if (!response.ok) {
                throw new Error('Failed to queue follow-up message');
            }
            return await response.json();
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.followUp.list(variables.sessionId),
            });
        },
    });
}

/**
 * Hook to remove a single queued follow-up message
 */
export function useRemoveFollowUpMessage() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ sessionId, messageId }: { sessionId: string; messageId: string }) => {
            const response = await client.api['follow-up'][':sessionId'][':messageId'].$delete({
                param: { sessionId, messageId },
            });
            if (!response.ok) {
                throw new Error('Failed to remove follow-up message');
            }
            return await response.json();
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.followUp.list(variables.sessionId),
            });
        },
    });
}

/**
 * Hook to clear all queued follow-up messages for a session
 */
export function useClearFollowUpMessages() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (sessionId: string) => {
            const response = await client.api['follow-up'][':sessionId'].$delete({
                param: { sessionId },
            });
            if (!response.ok) {
                throw new Error('Failed to clear follow-up messages');
            }
            return await response.json();
        },
        onSuccess: (_, sessionId) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.followUp.list(sessionId),
            });
        },
    });
}
