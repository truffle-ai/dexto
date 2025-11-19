import type {
    ApprovalHandler,
    ApprovalProvider,
    ApprovalResponse,
    ApprovalRequestDetails,
    ToolConfirmationMetadata,
    CommandConfirmationMetadata,
    ElicitationMetadata,
} from './types.js';
import { ApprovalType, ApprovalStatus } from './types.js';
import { EventBasedApprovalProvider } from './providers/event-based-approval-provider.js';
import { NoOpApprovalProvider } from './providers/noop-approval-provider.js';
import { createApprovalRequest } from './providers/factory.js';
import type { AgentEventBus } from '../events/index.js';
import type { IDextoLogger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { ApprovalError } from './errors.js';

/**
 * Configuration for the approval manager
 */
export interface ApprovalManagerConfig {
    toolConfirmation: {
        mode: 'manual' | 'auto-approve' | 'auto-deny';
        timeout: number;
    };
    elicitation: {
        enabled: boolean;
        timeout: number;
    };
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
    private handler?: ApprovalHandler & {
        cancel?: (approvalId: string) => void;
        cancelAll?: () => void;
        getPending?: () => string[];
    };
    private elicitationProvider: ApprovalProvider | null;
    private config: ApprovalManagerConfig;
    private logger: IDextoLogger;

    constructor(agentEventBus: AgentEventBus, config: ApprovalManagerConfig, logger: IDextoLogger) {
        this.config = config;
        this.logger = logger.createChild(DextoLogComponent.APPROVAL);

        // Create provider for elicitation (or null if disabled)
        // TODO: Convert elicitation to handler-based approach as well
        this.elicitationProvider = config.elicitation.enabled
            ? new EventBasedApprovalProvider(
                  agentEventBus,
                  {
                      defaultTimeout: config.elicitation.timeout,
                  },
                  this.logger
              )
            : null;

        this.logger.debug(
            `ApprovalManager initialized with toolConfirmation.mode: ${config.toolConfirmation.mode}, elicitation.enabled: ${config.elicitation.enabled}`
        );
    }

    /**
     * Request a generic approval
     */
    async requestApproval(details: ApprovalRequestDetails): Promise<ApprovalResponse> {
        const request = createApprovalRequest(details);

        // Route based on approval type
        if (request.type === ApprovalType.ELICITATION) {
            // Elicitation uses the provider (for now)
            if (this.elicitationProvider === null) {
                throw ApprovalError.invalidConfig(
                    'Elicitation is disabled. Enable elicitation in your agent configuration to use the ask_user tool or MCP server elicitations.'
                );
            }
            return this.elicitationProvider.requestApproval(request);
        }

        // Tool/command/custom confirmations use the handler-based approach
        return this.handleToolConfirmation(request);
    }

    /**
     * Handle tool/command/custom confirmation requests
     * @private
     */
    private async handleToolConfirmation(request: ApprovalRequest): Promise<ApprovalResponse> {
        const mode = this.config.toolConfirmation.mode;

        // Auto-approve mode
        if (mode === 'auto-approve') {
            this.logger.info(
                `Auto-approve approval '${request.type}', approvalId: ${request.approvalId}`
            );
            const response: ApprovalResponse = {
                approvalId: request.approvalId,
                status: ApprovalStatus.APPROVED,
            };
            if (request.sessionId !== undefined) {
                response.sessionId = request.sessionId;
            }
            return response;
        }

        // Auto-deny mode
        if (mode === 'auto-deny') {
            this.logger.info(
                `Auto-deny approval '${request.type}', approvalId: ${request.approvalId}`
            );
            const response: ApprovalResponse = {
                approvalId: request.approvalId,
                status: ApprovalStatus.DENIED,
                reason: DenialReason.SYSTEM_DENIED,
                message: `Approval automatically denied by system policy (auto-deny mode)`,
            };
            if (request.sessionId !== undefined) {
                response.sessionId = request.sessionId;
            }
            return response;
        }

        // Manual mode - delegate to handler
        const handler = this.ensureHandler();
        this.logger.info(
            `Manual approval '${request.type}' requested, approvalId: ${request.approvalId}, sessionId: ${request.sessionId ?? 'global'}`
        );
        return handler(request);
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
            timeout: timeout ?? this.config.toolConfirmation.timeout,
            metadata: toolMetadata,
        };

        if (sessionId !== undefined) {
            details.sessionId = sessionId;
        }

        return this.requestApproval(details);
    }

    /**
     * Request command confirmation approval
     * Convenience method for dangerous command execution within an already-approved tool
     *
     * This is different from tool confirmation - it's for per-command approval
     * of dangerous operations (like rm, git push) within tools that are already approved.
     *
     * @example
     * ```typescript
     * // bash_exec tool is approved, but dangerous commands still require approval
     * const response = await manager.requestCommandConfirmation({
     *   toolName: 'bash_exec',
     *   command: 'rm -rf /important',
     *   originalCommand: 'rm -rf /important',
     *   sessionId: 'session-123'
     * });
     * ```
     */
    async requestCommandConfirmation(
        metadata: CommandConfirmationMetadata & { sessionId?: string; timeout?: number }
    ): Promise<ApprovalResponse> {
        const { sessionId, timeout, ...commandMetadata } = metadata;

        const details: ApprovalRequestDetails = {
            type: ApprovalType.COMMAND_CONFIRMATION,
            timeout: timeout ?? this.config.toolConfirmation.timeout,
            metadata: commandMetadata,
        };

        if (sessionId !== undefined) {
            details.sessionId = sessionId;
        }

        return this.requestApproval(details);
    }

    /**
     * Request elicitation from MCP server
     * Convenience method for MCP elicitation requests
     *
     * Note: sessionId is optional because MCP servers are shared across sessions
     * and the MCP protocol doesn't include session context in elicitation requests.
     */
    async requestElicitation(
        metadata: ElicitationMetadata & { sessionId?: string; timeout?: number }
    ): Promise<ApprovalResponse> {
        const { sessionId, timeout, ...elicitationMetadata } = metadata;

        const details: ApprovalRequestDetails = {
            type: ApprovalType.ELICITATION,
            timeout: timeout ?? this.config.elicitation.timeout,
            metadata: elicitationMetadata,
        };

        if (sessionId !== undefined) {
            details.sessionId = sessionId;
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

        if (response.status === ApprovalStatus.APPROVED) {
            return true;
        } else if (response.status === ApprovalStatus.DENIED) {
            throw ApprovalError.toolConfirmationDenied(
                metadata.toolName,
                response.reason,
                response.message,
                metadata.sessionId
            );
        } else {
            throw ApprovalError.cancelled(
                response.approvalId,
                ApprovalType.TOOL_CONFIRMATION,
                response.message ?? response.reason
            );
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

        if (response.status === ApprovalStatus.APPROVED) {
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
        } else if (response.status === ApprovalStatus.DENIED) {
            throw ApprovalError.elicitationDenied(
                metadata.serverName,
                response.reason,
                response.message,
                metadata.sessionId
            );
        } else {
            throw ApprovalError.cancelled(
                response.approvalId,
                ApprovalType.ELICITATION,
                response.message ?? response.reason
            );
        }
    }

    /**
     * Cancel a specific approval request
     */
    cancelApproval(approvalId: string): void {
        // Try to cancel in handler if it supports cancellation
        this.handler?.cancel?.(approvalId);
        // Also cancel in elicitation provider
        this.elicitationProvider?.cancelApproval(approvalId);
    }

    /**
     * Cancel all pending approval requests
     */
    cancelAllApprovals(): void {
        // Cancel all in handler if it supports cancellation
        this.handler?.cancelAll?.();
        // Also cancel all in elicitation provider
        this.elicitationProvider?.cancelAllApprovals();
    }

    /**
     * Get list of pending approval IDs
     */
    getPendingApprovals(): string[] {
        // Get pending from handler if it supports it
        const handlerPending = this.handler?.getPending?.() ?? [];
        // Get pending from elicitation provider
        const elicitationPending = this.elicitationProvider?.getPendingApprovals() ?? [];
        return [...handlerPending, ...elicitationPending];
    }

    /**
     * Get current configuration
     */
    getConfig(): ApprovalManagerConfig {
        return { ...this.config };
    }

    /**
     * Set the approval handler for manual approval mode.
     *
     * The handler will be called whenever a tool/elicitation requires user approval
     * and toolConfirmation.mode is 'manual'. This must be set if using manual mode.
     *
     * @param handler The approval handler function, or null to clear
     */
    setHandler(handler: ApprovalHandler | null): void {
        this.handler = handler ?? undefined;
        this.logger.debug(`Approval handler ${handler ? 'registered' : 'cleared'}`);
    }

    /**
     * Clear the current approval handler
     */
    clearHandler(): void {
        this.handler = undefined;
        this.logger.debug('Approval handler cleared');
    }

    /**
     * Check if an approval handler is registered
     */
    hasHandler(): boolean {
        return !!this.handler;
    }

    /**
     * Get the approval handler, throwing if not set
     * @private
     */
    private ensureHandler(): ApprovalHandler {
        if (!this.handler) {
            throw ApprovalError.invalidConfig(
                'Tool confirmation mode is "manual" but no approval handler is configured.\n' +
                    'Either:\n' +
                    '  • set mode to "auto-approve" or "auto-deny", or\n' +
                    '  • call agent.setApprovalHandler(...) before processing requests.'
            );
        }
        return this.handler;
    }
}
