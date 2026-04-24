import type { ApprovalRequest, ApprovalResponse } from '../../approval/types.js';
import type { SessionApprovalState } from '../../approval/session-approval-store.js';

export interface ApprovalStore {
    createRequest(input: { request: ApprovalRequest }): Promise<void>;
    getRequest(input: { approvalId: string }): Promise<ApprovalRequest | undefined>;
    listPending(input: { sessionId?: string }): Promise<ApprovalRequest[]>;
    saveResponse(input: { response: ApprovalResponse }): Promise<void>;
    getResponse(input: { approvalId: string }): Promise<ApprovalResponse | undefined>;
    loadSessionState(input: { sessionId?: string }): Promise<SessionApprovalState>;
    saveSessionState(input: { sessionId?: string; state: SessionApprovalState }): Promise<void>;
    deleteSessionState(input: { sessionId?: string }): Promise<void>;
}
