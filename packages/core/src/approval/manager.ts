import type {
    ApprovalHandler,
    ApprovalRequest,
    ApprovalResponse,
    ApprovalRequestDetails,
    ToolConfirmationMetadata,
    CommandConfirmationMetadata,
    ElicitationMetadata,
} from './types.js';
import { ApprovalType, ApprovalStatus, DenialReason } from './types.js';
import { createApprovalRequest } from './factory.js';
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
 * - Support multiple approval modes (manual, auto-approve, auto-deny)
 *
 * @example
 * ```typescript
 * const manager = new ApprovalManager(
 *   { toolConfirmation: { mode: 'manual', timeout: 60000 }, elicitation: { enabled: true, timeout: 60000 } },
 *   logger
 * );
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
    private handler: ApprovalHandler | undefined;
    private config: ApprovalManagerConfig;
    private logger: IDextoLogger;

    constructor(config: ApprovalManagerConfig, logger: IDextoLogger) {
        this.config = config;
        this.logger = logger.createChild(DextoLogComponent.APPROVAL);

        this.logger.debug(
            `ApprovalManager initialized with toolConfirmation.mode: ${config.toolConfirmation.mode}, elicitation.enabled: ${config.elicitation.enabled}`
        );
    }

    /**
     * Request a generic approval
     */
    async requestApproval(details: ApprovalRequestDetails): Promise<ApprovalResponse> {
        const request = createApprovalRequest(details);

        // Check elicitation config if this is an elicitation request
        if (request.type === ApprovalType.ELICITATION && !this.config.elicitation.enabled) {
            throw ApprovalError.invalidConfig(
                'Elicitation is disabled. Enable elicitation in your agent configuration to use the ask_user tool or MCP server elicitations.'
            );
        }

        // Handle all approval types uniformly
        return this.handleApproval(request);
    }

    /**
     * Handle approval requests (tool confirmation, elicitation, command confirmation, custom)
     * @private
     */
    private async handleApproval(request: ApprovalRequest): Promise<ApprovalResponse> {
        // Elicitation always uses manual mode (requires handler)
        if (request.type === ApprovalType.ELICITATION) {
            const handler = this.ensureHandler();
            this.logger.info(
                `Elicitation requested, approvalId: ${request.approvalId}, sessionId: ${request.sessionId ?? 'global'}`
            );
            return handler(request);
        }

        // Tool/command/custom confirmations respect the configured mode
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
            // Extract formData from response (handler always provides formData for elicitation)
            if (
                response.data &&
                typeof response.data === 'object' &&
                'formData' in response.data &&
                typeof (response.data as { formData: unknown }).formData === 'object' &&
                (response.data as { formData: unknown }).formData !== null
            ) {
                return (response.data as { formData: Record<string, unknown> }).formData;
            }
            // Fallback to empty form if data is missing (edge case)
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
        this.handler?.cancel?.(approvalId);
    }

    /**
     * Cancel all pending approval requests
     */
    cancelAllApprovals(): void {
        this.handler?.cancelAll?.();
    }

    /**
     * Get list of pending approval IDs
     */
    getPendingApprovals(): string[] {
        return this.handler?.getPending?.() ?? [];
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
        if (handler === null) {
            this.handler = undefined;
        } else {
            this.handler = handler;
        }
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
    public hasHandler(): boolean {
        return this.handler !== undefined;
    }

    /**
     * Get the approval handler, throwing if not set
     * @private
     */
    private ensureHandler(): ApprovalHandler {
        if (!this.handler) {
            // TODO: add an example for usage here for users
            throw ApprovalError.invalidConfig(
                'An approval handler is required but not configured.\n' +
                    'Handlers are required for:\n' +
                    '  • manual tool confirmation mode\n' +
                    '  • all elicitation requests (when elicitation is enabled)\n' +
                    'Either:\n' +
                    '  • set toolConfirmation.mode to "auto-approve" or "auto-deny", or\n' +
                    '  • disable elicitation (set elicitation.enabled: false), or\n' +
                    '  • call agent.setApprovalHandler(...) before processing requests.'
            );
        }
        return this.handler;
    }
}
