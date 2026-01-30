import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { client } from '@/lib/client';
import { queryKeys } from '@/lib/queryKeys';

type ApprovalPayload = Parameters<(typeof client.api.approvals)[':approvalId']['$post']>[0]['json'];

export function useSubmitApproval() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (
            payload: { approvalId: string; sessionId: string } & ApprovalPayload
        ) => {
            const { approvalId, sessionId: _sessionId, ...body } = payload;
            const response = await client.api.approvals[':approvalId'].$post({
                param: { approvalId },
                json: body,
                header: {},
            });
            if (!response.ok) {
                throw new Error(`Failed to submit approval: ${response.status}`);
            }
            return await response.json();
        },
        onSuccess: (_, variables) => {
            // Invalidate pending approvals cache when an approval is submitted
            // Query is keyed by sessionId, not approvalId
            queryClient.invalidateQueries({
                queryKey: queryKeys.approvals.pending(variables.sessionId),
            });
        },
    });
}

/**
 * Hook to fetch pending approvals for a session.
 * Use this to restore approval UI state after page refresh.
 *
 * @param sessionId - The session ID to fetch pending approvals for
 * @param options.enabled - Whether to enable the query (default: true if sessionId provided)
 */
export function usePendingApprovals(sessionId: string | null, options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: queryKeys.approvals.pending(sessionId || ''),
        queryFn: async () => {
            if (!sessionId) return { approvals: [] };
            const response = await client.api.approvals.$get({
                query: { sessionId },
            });
            if (!response.ok) {
                throw new Error('Failed to fetch pending approvals');
            }
            return await response.json();
        },
        enabled: (options?.enabled ?? true) && !!sessionId,
    });
}

// Export inferred types for consumers
export type PendingApproval = NonNullable<
    ReturnType<typeof usePendingApprovals>['data']
>['approvals'][number];
