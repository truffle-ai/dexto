import { z } from 'zod';
import type { ApprovalRequest, ApprovalResponse } from '../../approval/types.js';

export const PersistedApprovedDirectorySchema = z
    .object({
        path: z.string(),
        type: z.enum(['session', 'once']),
    })
    .strict();

export const SessionApprovalStateSchema = z
    .object({
        toolPatterns: z.record(z.array(z.string())).default({}),
        approvedDirectories: z.array(PersistedApprovedDirectorySchema).default([]),
    })
    .strict();

export type PersistedApprovedDirectory = z.output<typeof PersistedApprovedDirectorySchema>;
export type SessionApprovalState = z.output<typeof SessionApprovalStateSchema>;

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
