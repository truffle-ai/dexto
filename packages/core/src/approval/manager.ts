import type {
    ApprovalProvider,
    ApprovalResponse,
    ApprovalRequestDetails,
    ToolConfirmationMetadata,
    ElicitationMetadata,
} from './types.js';
import { ApprovalType } from './types.js';
import { EventBasedApprovalProvider } from './providers/event-based-approval-provider.js';
import { NoOpApprovalProvider } from './providers/noop-approval-provider.js';
import type { AgentEventBus } from '../events/index.js';
import { logger } from '../logger/index.js';
import { ApprovalError } from './errors.js';

/**
 * Configuration for the approval manager
 */
export interface ApprovalManagerConfig {
    mode: 'event-based' | 'auto-approve' | 'auto-deny';
    timeout?: number;
}

/**
 * ApprovalManager orchestrates all user approval flows in Dexto.
 *
 * It provides a unified interface for requesting user approvals across different
 * types (tool confirmation, MCP elicitation, custom approvals) and manages the
 * underlying approval provider based on configuration.
 *
 * Key responsibilities:
 * - Create and submit approval requests
 * - Route approvals to appropriate providers
 * - Provide convenience methods for specific approval types
 * - Handle approval responses and errors
 * - Support multiple approval modes (event-based, auto-approve, auto-deny)
 *
 * @example
 * ```typescript
 * const manager = new ApprovalManager(eventBus, { mode: 'event-based' });
 *
 * // Request tool confirmation
 * const response = await manager.requestToolConfirmation({
 *   toolName: 'git_commit',
 *   args: { message: 'feat: add feature' },
 *   sessionId: 'session-123'
 * });
 *
 * if (response.status === 'approved') {
 *   // Execute tool
 * }
 * ```
 */
export class ApprovalManager {
    private provider: ApprovalProvider;
    private config: ApprovalManagerConfig;

    constructor(agentEventBus: AgentEventBus, config: ApprovalManagerConfig) {
        this.config = config;
        this.provider = this.createProvider(agentEventBus, config);

        logger.debug(
            `ApprovalManager initialized with mode: ${config.mode}, timeout: ${config.timeout ?? 120000}ms`
        );
    }

    /**
     * Create appropriate approval provider based on configuration
     */
    private createProvider(
        agentEventBus: AgentEventBus,
        config: ApprovalManagerConfig
    ): ApprovalProvider {
        switch (config.mode) {
            case 'event-based':
                return new EventBasedApprovalProvider(agentEventBus, {
                    defaultTimeout: config.timeout ?? 120000, // 2 minutes default
                });
            case 'auto-approve':
                return new NoOpApprovalProvider({ defaultStatus: 'approved' });
            case 'auto-deny':
                return new NoOpApprovalProvider({ defaultStatus: 'denied' });
            default:
                throw ApprovalError.invalidConfig(`Unknown approval mode: ${config.mode}`);
        }
    }

    /**
     * Request a generic approval
     */
    async requestApproval(details: ApprovalRequestDetails): Promise<ApprovalResponse> {
        const request = EventBasedApprovalProvider.createRequest(details);
        return this.provider.requestApproval(request);
    }

    /**
     * Request tool confirmation approval
     * Convenience method for tool execution confirmation
     */
    async requestToolConfirmation(
        metadata: ToolConfirmationMetadata & { sessionId?: string; timeout?: number }
    ): Promise<ApprovalResponse> {
        const { sessionId, timeout, ...toolMetadata } = metadata;

        const details: ApprovalRequestDetails = {
            type: ApprovalType.TOOL_CONFIRMATION,
            metadata: toolMetadata,
        };

        if (sessionId !== undefined) {
            details.sessionId = sessionId;
        }
        if (timeout !== undefined) {
            details.timeout = timeout;
        }

        return this.requestApproval(details);
    }

    /**
     * Request elicitation from MCP server
     * Convenience method for MCP elicitation requests
     */
    async requestElicitation(
        metadata: ElicitationMetadata & { sessionId?: string; timeout?: number }
    ): Promise<ApprovalResponse> {
        const { sessionId, timeout, ...elicitationMetadata } = metadata;

        const details: ApprovalRequestDetails = {
            type: ApprovalType.ELICITATION,
            metadata: elicitationMetadata,
        };

        if (sessionId !== undefined) {
            details.sessionId = sessionId;
        }
        if (timeout !== undefined) {
            details.timeout = timeout;
        }

        return this.requestApproval(details);
    }

    /**
     * Check if tool confirmation was approved
     * Throws appropriate error if denied
     */
    async checkToolConfirmation(
        metadata: ToolConfirmationMetadata & { sessionId?: string; timeout?: number }
    ): Promise<boolean> {
        const response = await this.requestToolConfirmation(metadata);

        if (response.status === 'approved') {
            return true;
        } else if (response.status === 'denied') {
            throw ApprovalError.toolConfirmationDenied(metadata.toolName, metadata.sessionId);
        } else {
            throw ApprovalError.cancelled(response.approvalId, ApprovalType.TOOL_CONFIRMATION);
        }
    }

    /**
     * Get elicitation form data
     * Throws appropriate error if denied or cancelled
     */
    async getElicitationData(
        metadata: ElicitationMetadata & { sessionId?: string; timeout?: number }
    ): Promise<Record<string, unknown>> {
        const response = await this.requestElicitation(metadata);

        if (response.status === 'approved') {
            // Handle auto-approve mode where data might be missing
            // Return empty formData object for approved-without-data case (e.g., NoOpApprovalProvider)
            if (
                response.data &&
                typeof response.data === 'object' &&
                'formData' in response.data &&
                typeof (response.data as { formData: unknown }).formData === 'object' &&
                (response.data as { formData: unknown }).formData !== null
            ) {
                return (response.data as { formData: Record<string, unknown> }).formData;
            }
            // Auto-approve without data returns empty form
            return {};
        } else if (response.status === 'denied') {
            throw ApprovalError.elicitationDenied(metadata.serverName, metadata.sessionId);
        } else {
            throw ApprovalError.cancelled(response.approvalId, ApprovalType.ELICITATION);
        }
    }

    /**
     * Cancel a specific approval request
     */
    cancelApproval(approvalId: string): void {
        this.provider.cancelApproval(approvalId);
    }

    /**
     * Cancel all pending approval requests
     */
    cancelAllApprovals(): void {
        this.provider.cancelAllApprovals();
    }

    /**
     * Get list of pending approval IDs
     */
    getPendingApprovals(): string[] {
        return this.provider.getPendingApprovals();
    }

    /**
     * Get current configuration
     */
    getConfig(): ApprovalManagerConfig {
        return { ...this.config };
    }
}
