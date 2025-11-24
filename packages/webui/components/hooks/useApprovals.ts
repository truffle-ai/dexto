import { useMutation } from '@tanstack/react-query';
import { client } from '@/lib/client';

type ApprovalPayload = Parameters<(typeof client.api.approvals)[':approvalId']['$post']>[0]['json'];

export function useSubmitApproval() {
    return useMutation({
        mutationFn: async (payload: { approvalId: string } & ApprovalPayload) => {
            const { approvalId, ...body } = payload;
            const response = await client.api.approvals[':approvalId'].$post({
                param: { approvalId },
                json: body,
                header: {},
            });
            return await response.json();
        },
    });
}
