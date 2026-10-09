import {
    ApprovalStatus,
    DenialReason,
    type ApprovalRequest,
    type ApprovalResponse,
} from '@dexto/core';

export async function handleHeadlessApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
    return {
        approvalId: request.approvalId,
        status: ApprovalStatus.DENIED,
        reason: DenialReason.SYSTEM_DENIED,
        message:
            'This operation requires interactive approval. Run the task in the Dexto TUI to review it.',
        ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
        ...(request.hostRuntime !== undefined ? { hostRuntime: request.hostRuntime } : {}),
    };
}
