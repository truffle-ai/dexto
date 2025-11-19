import { randomUUID } from 'crypto';
import type { ApprovalRequest, ApprovalRequestDetails } from './types.js';

/**
 * Factory function to create an approval request with generated ID and timestamp.
 *
 * This is a generic helper used by ApprovalManager to create properly
 * formatted approval requests from simplified details.
 *
 * @param details - Simplified approval request details without ID and timestamp
 * @returns A complete ApprovalRequest with generated UUID and current timestamp
 */
export function createApprovalRequest(details: ApprovalRequestDetails): ApprovalRequest {
    return {
        approvalId: randomUUID(),
        type: details.type,
        sessionId: details.sessionId,
        timeout: details.timeout,
        timestamp: new Date(),
        metadata: details.metadata,
    } as ApprovalRequest;
}
