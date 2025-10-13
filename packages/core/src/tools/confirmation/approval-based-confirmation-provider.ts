import type { ToolConfirmationProvider, ToolExecutionDetails } from './types.js';
import type { IAllowedToolsProvider } from './allowed-tools-provider/types.js';
import type { ApprovalManager } from '../../approval/manager.js';
import { ApprovalStatus } from '../../approval/types.js';
import { logger } from '../../logger/index.js';

/**
 * Tool confirmation provider that uses the new ApprovalManager system.
 *
 * This provider bridges the old tool confirmation interface with the new
 * generalized approval system, providing backward compatibility while
 * enabling future extensibility.
 */
export class ApprovalBasedConfirmationProvider implements ToolConfirmationProvider {
    constructor(
        public allowedToolsProvider: IAllowedToolsProvider,
        private approvalManager: ApprovalManager
    ) {}

    async requestConfirmation(details: ToolExecutionDetails): Promise<boolean> {
        // Check if tool is in allowed list first
        const isAllowed = await this.allowedToolsProvider.isToolAllowed(
            details.toolName,
            details.sessionId
        );

        if (isAllowed) {
            logger.info(
                `Tool '${details.toolName}' already allowed for session '${details.sessionId ?? 'global'}' – skipping confirmation.`
            );
            return true;
        }

        logger.info(
            `Tool confirmation requested for ${details.toolName}, sessionId: ${details.sessionId}`
        );

        try {
            // Request approval through the ApprovalManager
            const requestData: {
                toolName: string;
                args: Record<string, unknown>;
                sessionId?: string;
                description?: string;
            } = {
                toolName: details.toolName,
                args: details.args,
            };

            if (details.sessionId !== undefined) {
                requestData.sessionId = details.sessionId;
            }
            if (details.description !== undefined) {
                requestData.description = details.description;
            }

            const response = await this.approvalManager.requestToolConfirmation(requestData);

            // Handle remember choice if approved
            const rememberChoice =
                response.data && 'rememberChoice' in response.data
                    ? response.data.rememberChoice
                    : false;

            if (response.status === ApprovalStatus.APPROVED && rememberChoice) {
                await this.allowedToolsProvider.allowTool(details.toolName, response.sessionId);
                logger.info(
                    `Tool '${details.toolName}' added to allowed tools for session '${response.sessionId ?? 'global'}' (remember choice selected)`
                );
            }

            const approved = response.status === ApprovalStatus.APPROVED;

            logger.info(
                `Tool confirmation ${approved ? 'approved' : 'denied'} for ${details.toolName}, sessionId: ${details.sessionId ?? 'global'}`
            );

            return approved;
        } catch (error) {
            // Log and re-throw - errors are already properly formatted by ApprovalManager
            logger.error(
                `Tool confirmation error for ${details.toolName}: ${error instanceof Error ? error.message : String(error)}`
            );
            throw error;
        }
    }

    /**
     * Get list of pending confirmation requests
     */
    getPendingConfirmations(): string[] {
        return this.approvalManager.getPendingApprovals();
    }

    /**
     * Cancel a pending confirmation request
     */
    cancelConfirmation(executionId: string): void {
        this.approvalManager.cancelApproval(executionId);
    }

    /**
     * Cancel all pending confirmation requests
     */
    cancelAllConfirmations(): void {
        this.approvalManager.cancelAllApprovals();
    }
}
