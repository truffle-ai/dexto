import {
    ApprovalStatus,
    DenialReason,
    type ApprovalRequest,
    type AgentEventBus,
    type ApprovalResponse,
} from '@dexto/core';

export const HEADLESS_APPROVAL_MESSAGE =
    'This operation requires interactive approval. Run the task in the Dexto TUI to review it.';

export async function handleHeadlessApproval(
    request: ApprovalRequest,
    eventBus: Pick<AgentEventBus, 'emit'>,
    runSessionId: string | undefined
): Promise<ApprovalResponse> {
    // Attribute legacy unscoped requests to this headless run without changing the denial envelope.
    const eventScope =
        request.sessionId === undefined && runSessionId !== undefined
            ? { sessionId: runSessionId }
            : {};
    eventBus.emit('approval:request', { ...request, ...eventScope });
    const response: ApprovalResponse = {
        approvalId: request.approvalId,
        status: ApprovalStatus.DENIED,
        reason: DenialReason.SYSTEM_DENIED,
        message: HEADLESS_APPROVAL_MESSAGE,
        ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
        ...(request.hostRuntime !== undefined ? { hostRuntime: request.hostRuntime } : {}),
    };
    eventBus.emit('approval:response', { ...response, ...eventScope });
    return response;
}
