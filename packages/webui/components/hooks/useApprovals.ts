import { useMutation } from '@tanstack/react-query';
import { client } from '@/lib/client';

export function useSubmitApproval() {
    return useMutation({
        mutationFn: async (payload: any) => {
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
