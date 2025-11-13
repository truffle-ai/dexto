import type {
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
        mode: 'event-based' | 'auto-approve' | 'auto-deny';
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
    private toolProvider: ApprovalProvider;
    private elicitationProvider: ApprovalProvider | null;
    private config: ApprovalManagerConfig;
    private logger: IDextoLogger;

    constructor(agentEventBus: AgentEventBus, config: ApprovalManagerConfig, logger: IDextoLogger) {
        this.config = config;
        this.logger = logger.createChild(DextoLogComponent.APPROVAL);

        // Create provider for tool/command confirmations
        this.toolProvider = this.createToolProvider(agentEventBus, config.toolConfirmation);

        // Create provider for elicitation (or null if disabled)
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
     * Create appropriate approval provider for tool/command confirmations
     */
    private createToolProvider(
        agentEventBus: AgentEventBus,
        toolConfig: { mode: 'event-based' | 'auto-approve' | 'auto-deny'; timeout: number }
    ): ApprovalProvider {
        switch (toolConfig.mode) {
            case 'event-based':
                return new EventBasedApprovalProvider(
                    agentEventBus,
                    {
                        defaultTimeout: toolConfig.timeout,
                    },
                    this.logger
                );
            case 'auto-approve':
                return new NoOpApprovalProvider(
                    { defaultStatus: ApprovalStatus.APPROVED },
                    this.logger
                );
            case 'auto-deny':
                return new NoOpApprovalProvider(
                    { defaultStatus: ApprovalStatus.DENIED },
                    this.logger
                );
            default:
                throw ApprovalError.invalidConfig(
                    `Unknown approval mode: ${toolConfig.mode as string}`
                );
        }
    }

    /**
     * Get the appropriate provider based on approval type
     */
    private getProviderForType(type: ApprovalType): ApprovalProvider {
        if (type === ApprovalType.ELICITATION) {
            if (this.elicitationProvider === null) {
                throw ApprovalError.invalidConfig(
                    'Elicitation is disabled. Enable elicitation in your agent configuration to use the ask_user tool or MCP server elicitations.'
                );
            }
            return this.elicitationProvider;
        }
        // All other types (TOOL_CONFIRMATION, COMMAND_CONFIRMATION, CUSTOM) use tool provider
        return this.toolProvider;
    }

    /**
     * Request a generic approval
     */
    async requestApproval(details: ApprovalRequestDetails): Promise<ApprovalResponse> {
        const request = createApprovalRequest(details);
        const provider = this.getProviderForType(request.type);
        return provider.requestApproval(request);
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
        // Try to cancel in both providers since we don't track which provider owns which ID
        this.toolProvider.cancelApproval(approvalId);
        this.elicitationProvider?.cancelApproval(approvalId);
    }

    /**
     * Cancel all pending approval requests
     */
    cancelAllApprovals(): void {
        this.toolProvider.cancelAllApprovals();
        this.elicitationProvider?.cancelAllApprovals();
    }

    /**
     * Get list of pending approval IDs
     */
    getPendingApprovals(): string[] {
        const toolApprovals = this.toolProvider.getPendingApprovals();
        const elicitationApprovals = this.elicitationProvider?.getPendingApprovals() ?? [];
        return [...toolApprovals, ...elicitationApprovals];
    }

    /**
     * Get current configuration
     */
    getConfig(): ApprovalManagerConfig {
        return { ...this.config };
    }
}
