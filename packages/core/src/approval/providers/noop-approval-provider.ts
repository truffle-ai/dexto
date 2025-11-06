import type {
    ApprovalProvider,
    ApprovalRequest,
    ApprovalResponse,
    ApprovalStatus,
} from '../types.js';
import type { IDextoLogger } from '../../logger/v2/types.js';
import { DextoLogComponent } from '../../logger/v2/types.js';

/**
 * No-op approval provider that automatically approves or denies all requests
 * without user interaction.
 *
 * Used for auto-approve and auto-deny modes.
 */
export class NoOpApprovalProvider implements ApprovalProvider {
    private defaultStatus: ApprovalStatus;
    private logger: IDextoLogger;

    constructor(options: { defaultStatus: ApprovalStatus }, logger: IDextoLogger) {
        this.defaultStatus = options.defaultStatus;
        this.logger = logger.createChild(DextoLogComponent.APPROVAL);
    }

    async requestApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
        this.logger.info(
            `Auto-${this.defaultStatus} approval '${request.type}', approvalId: ${request.approvalId}`
        );

        const response: ApprovalResponse = {
            approvalId: request.approvalId,
            status: this.defaultStatus,
        };

        if (request.sessionId !== undefined) {
            response.sessionId = request.sessionId;
        }

        return response;
    }

    cancelApproval(_approvalId: string): void {
        // No-op: nothing to cancel since approvals are instant
    }

    cancelAllApprovals(): void {
        // No-op: nothing to cancel since approvals are instant
    }

    getPendingApprovals(): string[] {
        return []; // No pending approvals in this mode
    }
}
