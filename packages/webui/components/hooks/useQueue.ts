import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';
import type { Attachment } from '../../lib/attachment-types.js';

/**
 * Hook to fetch queued messages for a session
 */
export function useQueuedMessages(sessionId: string | null) {
    return useQuery({
        queryKey: queryKeys.queue.list(sessionId ?? ''),
        queryFn: async () => {
            if (!sessionId) return { messages: [], count: 0 };
            const response = await client.api.queue[':sessionId'].$get({
                param: { sessionId },
            });
            if (!response.ok) {
                throw new Error('Failed to fetch queued messages');
            }
            return await response.json();
        },
        enabled: !!sessionId,
        // Refetch frequently while processing to show queue updates
        refetchInterval: (query) => ((query.state.data?.count ?? 0) > 0 ? 2000 : false),
    });
}

// Export type for queued message
export type QueuedMessage = NonNullable<
    ReturnType<typeof useQueuedMessages>['data']
>['messages'][number];

/**
 * Hook to queue a new message
 */
export function useQueueMessage() {
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
            // Build content parts array from text and attachments
            const contentParts: Array<
                | { type: 'text'; text: string }
                | { type: 'image'; image: string; mimeType?: string }
                | { type: 'file'; data: string; mimeType: string; filename?: string }
            > = [];

            if (message) {
                contentParts.push({ type: 'text', text: message });
            }

            if (attachments) {
                for (const attachment of attachments) {
                    if (attachment.type === 'image') {
                        contentParts.push({
                            type: 'image',
                            image: attachment.data,
                            mimeType: attachment.mimeType,
                        });
                    } else {
                        contentParts.push({
                            type: 'file',
                            data: attachment.data,
                            mimeType: attachment.mimeType,
                            filename: attachment.filename,
                        });
                    }
                }
            }

            const response = await client.api.queue[':sessionId'].$post({
                param: { sessionId },
                json: {
                    content:
                        contentParts.length === 1 && contentParts[0]?.type === 'text'
                            ? message! // Simple text-only case: send as string
                            : contentParts, // Multimodal: send as array
                },
            });
            if (!response.ok) {
                throw new Error('Failed to queue message');
            }
            return await response.json();
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.queue.list(variables.sessionId),
            });
        },
    });
}

/**
 * Hook to remove a single queued message
 */
export function useRemoveQueuedMessage() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ sessionId, messageId }: { sessionId: string; messageId: string }) => {
            const response = await client.api.queue[':sessionId'][':messageId'].$delete({
                param: { sessionId, messageId },
            });
            if (!response.ok) {
                throw new Error('Failed to remove queued message');
            }
            return await response.json();
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.queue.list(variables.sessionId),
            });
        },
    });
}

/**
 * Hook to clear all queued messages for a session
 */
export function useClearQueue() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (sessionId: string) => {
            const response = await client.api.queue[':sessionId'].$delete({
                param: { sessionId },
            });
            if (!response.ok) {
                throw new Error('Failed to clear queue');
            }
            return await response.json();
        },
        onSuccess: (_, sessionId) => {
            queryClient.invalidateQueries({
                queryKey: queryKeys.queue.list(sessionId),
            });
        },
    });
}
