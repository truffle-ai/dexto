import { isDeepStrictEqual } from 'node:util';
import type {
    ApprovalHandler,
    ApprovalRequest,
    ApprovalResponse,
    ApprovalRequestDetails,
    ToolApprovalMetadata,
    CommandApprovalMetadata,
    ElicitationMetadata,
} from './types.js';
import { ApprovalType, ApprovalStatus } from './types.js';
import {
    CommandApprovalResponseSchema,
    CustomApprovalResponseSchema,
    ElicitationResponseSchema,
    ToolApprovalResponseSchema,
} from './schemas.js';
import { createApprovalRequest, createDeterministicApprovalId } from './factory.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { ApprovalError } from './errors.js';
import type { PermissionsMode } from '../tools/schemas.js';
import type { ApprovalStore, SessionApprovalState } from '../storage/approvals/types.js';

const GLOBAL_APPROVAL_SCOPE = '__global__';

type ApprovalScopeState = {
    approvedKeys: Map<string, 'session' | 'once'>;
};

export type ApprovalRecordIdentity = {
    runId: string;
    turnId: string;
    modelStepId: string;
    toolCallId: string;
};

export type ApprovalDecisionInput =
    | {
          approvalId: ApprovalRequest['approvalId'];
          status: typeof ApprovalStatus.APPROVED;
          data?: ApprovalResponse['data'];
      }
    | {
          approvalId: ApprovalRequest['approvalId'];
          status: typeof ApprovalStatus.DENIED | typeof ApprovalStatus.CANCELLED;
          reason?: ApprovalResponse['reason'];
          message?: string;
          timeoutMs?: number;
          data?: ApprovalResponse['data'];
      };

export type ApprovalResponseRecord = {
    response: ApprovalResponse;
    status: 'created' | 'replayed';
};

/**
 * Configuration for the approval manager
 */
export interface ApprovalManagerConfig {
    permissions: {
        mode: PermissionsMode;
        timeout?: number; // Optional - no timeout if not specified
    };
    elicitation: {
        enabled: boolean;
        timeout?: number; // Optional - no timeout if not specified
    };
}

/**
 * ApprovalManager orchestrates all user approval flows in Dexto.
 *
 * It provides a unified interface for requesting user approvals across different
 * types (tool approval, MCP elicitation, custom approvals) and manages the
 * underlying approval provider based on configuration.
 *
 * Key responsibilities:
 * - Create and submit approval requests
 * - Route approvals to appropriate providers
 * - Provide convenience methods for specific approval types
 * - Handle approval responses and errors
 * - Support multiple approval modes (manual, auto-approve)
 *
 * @example
 * ```typescript
 * const manager = new ApprovalManager(
 *   { permissions: { mode: 'manual', timeout: 60000 }, elicitation: { enabled: true, timeout: 60000 } },
 *   logger
 * );
 *
 * // Request tool approval
 * const response = await manager.requestToolApproval({
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
    private logger: Logger;
    private readonly loadedScopes = new Set<string>();
    private readonly scopeLocks = new Map<string, Promise<void>>();
    private readonly approvalRecordLocks = new Map<string, Promise<void>>();
    private readonly scopes = new Map<string, ApprovalScopeState>();

    constructor(
        config: ApprovalManagerConfig,
        logger: Logger,
        private readonly approvalStore: ApprovalStore
    ) {
        this.config = config;
        this.logger = logger.createChild(DextoLogComponent.APPROVAL);

        this.logger.debug(
            `ApprovalManager initialized with permissions.mode: ${config.permissions.mode}, elicitation.enabled: ${config.elicitation.enabled}`
        );
    }

    private getScopeKey(sessionId?: string): string {
        return sessionId ?? GLOBAL_APPROVAL_SCOPE;
    }

    private getScopeLabel(sessionId?: string): string {
        return sessionId ?? 'global';
    }

    private sessionScope(sessionId: string | undefined): { sessionId?: string } {
        return sessionId === undefined ? {} : { sessionId };
    }

    private getApprovalTimeout(type: ApprovalType, timeout?: number): number | undefined {
        return timeout ?? this.getDefaultTimeout(type);
    }

    private getDefaultTimeout(type: ApprovalType): number | undefined {
        return type === ApprovalType.ELICITATION
            ? this.config.elicitation.timeout
            : this.config.permissions.timeout;
    }

    private createEmptyScopeState(): ApprovalScopeState {
        return {
            approvedKeys: new Map(),
        };
    }

    private getOrCreateScope(scopeKey: string): ApprovalScopeState {
        const existing = this.scopes.get(scopeKey);
        if (existing) return existing;
        const created = this.createEmptyScopeState();
        this.scopes.set(scopeKey, created);
        return created;
    }

    private getScope(scopeKey: string): ApprovalScopeState {
        return this.scopes.get(scopeKey) ?? this.createEmptyScopeState();
    }

    private async runWithScopeLock<T>(scopeKey: string, fn: () => Promise<T>): Promise<T> {
        const previousLock = this.scopeLocks.get(scopeKey) ?? Promise.resolve();
        const currentResult = previousLock.catch(() => {}).then(() => fn());
        const currentLock = currentResult.then(
            () => undefined,
            () => undefined
        );

        this.scopeLocks.set(scopeKey, currentLock);

        try {
            return await currentResult;
        } finally {
            if (this.scopeLocks.get(scopeKey) === currentLock) {
                this.scopeLocks.delete(scopeKey);
            }
        }
    }

    private async runWithApprovalRecordLock<T>(
        approvalId: string,
        fn: () => Promise<T>
    ): Promise<T> {
        const previousLock = this.approvalRecordLocks.get(approvalId) ?? Promise.resolve();
        const currentResult = previousLock.catch(() => {}).then(() => fn());
        const currentLock = currentResult.then(
            () => undefined,
            () => undefined
        );

        this.approvalRecordLocks.set(approvalId, currentLock);

        try {
            return await currentResult;
        } finally {
            if (this.approvalRecordLocks.get(approvalId) === currentLock) {
                this.approvalRecordLocks.delete(approvalId);
            }
        }
    }

    private snapshotApprovedKeys(scopeKey: string): Record<string, 'session' | 'once'> {
        return Object.fromEntries(this.getScope(scopeKey).approvedKeys.entries());
    }

    private async persistScope(sessionId?: string): Promise<void> {
        const scopeKey = this.getScopeKey(sessionId);
        const state: SessionApprovalState = {
            approvedKeys: this.snapshotApprovedKeys(scopeKey),
        };
        await this.approvalStore.saveSessionState({
            ...this.sessionScope(sessionId),
            state,
        });
    }

    private hydrateScope(sessionId: string | undefined, state: SessionApprovalState): void {
        const scopeKey = this.getScopeKey(sessionId);

        const approvedKeys = new Map<string, 'session' | 'once'>();
        for (const [key, type] of Object.entries(state.approvedKeys ?? {})) {
            approvedKeys.set(key, type);
        }

        this.scopes.set(scopeKey, {
            approvedKeys,
        });
    }

    async restoreSessionState(sessionId?: string): Promise<void> {
        const scopeKey = this.getScopeKey(sessionId);
        if (this.loadedScopes.has(scopeKey)) {
            return;
        }

        await this.runWithScopeLock(scopeKey, async () => {
            if (this.loadedScopes.has(scopeKey)) {
                return;
            }

            const state = await this.approvalStore.loadSessionState(this.sessionScope(sessionId));
            this.hydrateScope(sessionId, state);
            this.loadedScopes.add(scopeKey);

            this.logger.debug('Restored persisted approval state', {
                sessionId: this.getScopeLabel(sessionId),
                keyCount: Object.keys(state.approvedKeys ?? {}).length,
            });
        });
    }

    evictSessionState(sessionId?: string): void {
        const scopeKey = this.getScopeKey(sessionId);
        this.scopes.delete(scopeKey);
        this.loadedScopes.delete(scopeKey);
    }

    async deleteSessionState(sessionId?: string): Promise<void> {
        const scopeKey = this.getScopeKey(sessionId);
        await this.runWithScopeLock(scopeKey, async () => {
            this.evictSessionState(sessionId);
            await this.approvalStore.deleteSessionState(this.sessionScope(sessionId));
        });
    }

    // ==================== Generic Approval Key Methods ====================

    async addApprovedKey(
        key: string,
        type: 'session' | 'once' = 'session',
        sessionId?: string
    ): Promise<void> {
        await this.restoreSessionState(sessionId);
        const scopeKey = this.getScopeKey(sessionId);

        await this.runWithScopeLock(scopeKey, async () => {
            const approvedKeys = this.getOrCreateScope(scopeKey).approvedKeys;
            const existing = approvedKeys.get(key);
            const effectiveType: 'session' | 'once' =
                type === 'session' || existing === 'session' ? 'session' : 'once';
            approvedKeys.set(key, effectiveType);
            await this.persistScope(sessionId);
        });
    }

    isApprovalKeySessionApproved(key: string, sessionId?: string): boolean {
        return this.getScope(this.getScopeKey(sessionId)).approvedKeys.get(key) === 'session';
    }

    isApprovalKeyApproved(key: string, sessionId?: string): boolean {
        return this.getScope(this.getScopeKey(sessionId)).approvedKeys.has(key);
    }

    getApprovedKeys(sessionId?: string): ReadonlyMap<string, 'session' | 'once'> {
        return this.getScope(this.getScopeKey(sessionId)).approvedKeys;
    }

    async clearApprovedKeys(sessionId?: string): Promise<void> {
        await this.restoreSessionState(sessionId);
        const scopeKey = this.getScopeKey(sessionId);

        await this.runWithScopeLock(scopeKey, async () => {
            const approvedKeys = this.getOrCreateScope(scopeKey).approvedKeys;
            if (approvedKeys.size === 0) return;
            approvedKeys.clear();
            await this.persistScope(sessionId);
        });
    }

    // ==================== Directory Access Methods ====================

    /**
     * Resolve a directory path for use as an approval key.
     *
     * We store BOTH the resolved path and (when available) its realpath, so approvals
     * continue to work even when other subsystems canonicalize paths via realpath
     * (e.g. macOS /tmp -> /private/tmp or custom symlinked directories).
     */
    /**
     * Clear all session-scoped approvals.
     * Convenience method for clearing all session state at once.
     */
    async clearSessionApprovals(sessionId?: string): Promise<void> {
        await this.restoreSessionState(sessionId);
        const scopeKey = this.getScopeKey(sessionId);

        await this.runWithScopeLock(scopeKey, async () => {
            const scope = this.getOrCreateScope(scopeKey);
            const keyCount = scope.approvedKeys.size;

            scope.approvedKeys.clear();
            await this.persistScope(sessionId);

            if (keyCount > 0) {
                this.logger.debug(
                    `Cleared ${keyCount} approval key(s) in '${this.getScopeLabel(sessionId)}'`
                );
            }
        });
    }

    private createApprovalDetails(
        type: ApprovalType,
        metadata: ApprovalRequestDetails['metadata'],
        sessionId: string | undefined,
        hostRuntime?: ApprovalRequestDetails['hostRuntime'],
        timeout?: number
    ): ApprovalRequestDetails {
        const details: ApprovalRequestDetails = {
            type,
            timeout: this.getApprovalTimeout(type, timeout),
            metadata,
        };

        if (sessionId !== undefined) {
            details.sessionId = sessionId;
        }
        if (hostRuntime !== undefined) {
            details.hostRuntime = hostRuntime;
        }

        return details;
    }

    private withDefaultTimeout(details: ApprovalRequestDetails): ApprovalRequestDetails {
        return {
            ...details,
            timeout: this.getApprovalTimeout(details.type, details.timeout),
        };
    }

    private approvalIdentityKey(identity: ApprovalRecordIdentity): string {
        return JSON.stringify([
            identity.runId,
            identity.turnId,
            identity.modelStepId,
            identity.toolCallId,
        ]);
    }

    private assertMatchingRecordedRequest(
        existing: ApprovalRequest,
        candidate: ApprovalRequest
    ): void {
        const existingComparable = {
            type: existing.type,
            sessionId: existing.sessionId,
            hostRuntime: existing.hostRuntime,
            timeout: existing.timeout,
            metadata: existing.metadata,
        };
        const candidateComparable = {
            type: candidate.type,
            sessionId: candidate.sessionId,
            hostRuntime: candidate.hostRuntime,
            timeout: candidate.timeout,
            metadata: candidate.metadata,
        };

        if (!isDeepStrictEqual(existingComparable, candidateComparable)) {
            throw ApprovalError.invalidRequest(
                'Approval request conflicts with existing approval request',
                {
                    approvalId: existing.approvalId,
                    type: existing.type,
                }
            );
        }
    }

    private createResponse(
        request: ApprovalRequest,
        response: Omit<ApprovalResponse, 'approvalId' | 'sessionId'>
    ): ApprovalResponse {
        return {
            status: response.status,
            approvalId: request.approvalId,
            ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
            ...(request.hostRuntime !== undefined ? { hostRuntime: request.hostRuntime } : {}),
            ...(response.reason !== undefined ? { reason: response.reason } : {}),
            ...(response.message !== undefined ? { message: response.message } : {}),
            ...(response.timeoutMs !== undefined ? { timeoutMs: response.timeoutMs } : {}),
            ...(response.data !== undefined ? { data: response.data } : {}),
        };
    }

    private parseResponseForRequest(
        request: ApprovalRequest,
        response: ApprovalResponse
    ): ApprovalResponse {
        switch (request.type) {
            case ApprovalType.TOOL_APPROVAL:
                return ToolApprovalResponseSchema.parse(response);
            case ApprovalType.COMMAND_APPROVAL:
                return CommandApprovalResponseSchema.parse(response);
            case ApprovalType.ELICITATION:
                return ElicitationResponseSchema.parse(response);
            case ApprovalType.CUSTOM:
                return CustomApprovalResponseSchema.parse(response);
        }
    }

    private getElicitationFormData(response: ApprovalResponse): Record<string, unknown> {
        if (
            response.data &&
            typeof response.data === 'object' &&
            'formData' in response.data &&
            typeof (response.data as { formData: unknown }).formData === 'object' &&
            (response.data as { formData: unknown }).formData !== null
        ) {
            return (response.data as { formData: Record<string, unknown> }).formData;
        }

        if (
            response.data === undefined ||
            (typeof response.data === 'object' &&
                response.data !== null &&
                !('formData' in response.data))
        ) {
            return {};
        }

        throw ApprovalError.invalidResponse('Approved elicitation response is missing formData', {
            approvalId: response.approvalId,
            type: ApprovalType.ELICITATION,
            field: 'formData',
        });
    }

    /**
     * Request a generic approval
     */
    async requestApproval(details: ApprovalRequestDetails): Promise<ApprovalResponse> {
        const request = createApprovalRequest(this.withDefaultTimeout(details));

        // Check elicitation config if this is an elicitation request
        if (request.type === ApprovalType.ELICITATION && !this.config.elicitation.enabled) {
            throw ApprovalError.invalidConfig(
                'Elicitation is disabled. Enable elicitation in your agent configuration to use the ask_user tool or MCP server elicitations.'
            );
        }

        // Handle all approval types uniformly
        return this.handleApproval(request);
    }

    async recordApprovalRequest(
        details: ApprovalRequestDetails,
        identity: ApprovalRecordIdentity
    ): Promise<ApprovalRequest> {
        if (details.type === ApprovalType.ELICITATION && !this.config.elicitation.enabled) {
            throw ApprovalError.invalidConfig(
                'Elicitation is disabled. Enable elicitation in your agent configuration to use the ask_user tool or MCP server elicitations.'
            );
        }

        const approvalId = createDeterministicApprovalId(this.approvalIdentityKey(identity));
        const request = createApprovalRequest(this.withDefaultTimeout(details), approvalId);
        return this.runWithApprovalRecordLock(approvalId, async () => {
            const existing = await this.approvalStore.getRequest({ approvalId });
            if (existing) {
                this.assertMatchingRecordedRequest(existing, request);
                return existing;
            }

            const recorded = await this.approvalStore.createRequest({ request });
            this.assertMatchingRecordedRequest(recorded, request);
            return recorded;
        });
    }

    async recordApprovalResponse(decision: ApprovalDecisionInput): Promise<ApprovalResponse> {
        const record = await this.recordApprovalResponseRecord(decision);
        return record.response;
    }

    async recordApprovalResponseRecord(
        decision: ApprovalDecisionInput,
        expectedRequest?: ApprovalRequest
    ): Promise<ApprovalResponseRecord> {
        return this.runWithApprovalRecordLock(decision.approvalId, async () => {
            const request = await this.approvalStore.getRequest({
                approvalId: decision.approvalId,
            });
            if (!request) {
                throw ApprovalError.invalidResponse('Approval response has no recorded request', {
                    approvalId: decision.approvalId,
                });
            }
            if (expectedRequest !== undefined) {
                this.assertMatchingRecordedRequest(request, expectedRequest);
            }

            const response = this.parseResponseForRequest(
                request,
                this.createResponse(request, decision)
            );
            const existing = await this.approvalStore.getResponse({
                approvalId: decision.approvalId,
            });
            if (existing) {
                if (!isDeepStrictEqual(existing, response)) {
                    throw ApprovalError.invalidResponse(
                        'Approval response conflicts with existing approval response',
                        {
                            approvalId: decision.approvalId,
                        }
                    );
                }
                return { response: existing, status: 'replayed' };
            }

            const record = await this.approvalStore.saveResponse({ response });
            if (!isDeepStrictEqual(record.response, response)) {
                throw ApprovalError.invalidResponse(
                    'Approval response conflicts with existing approval response',
                    {
                        approvalId: decision.approvalId,
                    }
                );
            }
            return record;
        });
    }

    async requestApprovalDecision(request: ApprovalRequest): Promise<ApprovalResponse> {
        return this.handleApproval(request);
    }

    /**
     * Handle approval requests (tool approval, elicitation, command approval, directory access, custom)
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

        // Tool/command/directory-access/custom approvals respect the configured mode
        const mode = this.config.permissions.mode;

        // Auto-approve mode
        if (mode === 'auto-approve') {
            this.logger.info(
                `Auto-approve approval '${request.type}', approvalId: ${request.approvalId}`
            );
            return this.createResponse(request, {
                status: ApprovalStatus.APPROVED,
            });
        }

        // Manual mode - delegate to handler
        const handler = this.ensureHandler();
        this.logger.info(
            `Manual approval '${request.type}' requested, approvalId: ${request.approvalId}, sessionId: ${request.sessionId ?? 'global'}`
        );
        return handler(request);
    }

    /**
     * Request tool approval
     * Convenience method for tool execution approval
     *
     * TODO: Make sessionId required once all callers are updated to pass it
     * Tool approvals always happen in session context during LLM execution
     */
    async requestToolApproval(
        metadata: ToolApprovalMetadata & {
            sessionId?: string;
            hostRuntime?: ApprovalRequestDetails['hostRuntime'];
            timeout?: number;
        }
    ): Promise<ApprovalResponse> {
        const { sessionId, hostRuntime, timeout, ...toolMetadata } = metadata;
        return this.requestApproval(
            this.createApprovalDetails(
                ApprovalType.TOOL_APPROVAL,
                toolMetadata,
                sessionId,
                hostRuntime,
                timeout
            )
        );
    }

    /**
     * Request command approval
     * Convenience method for dangerous command execution within an already-approved tool
     *
     * This is different from tool approval - it's for per-command approval
     * of dangerous operations (like rm, git push) within tools that are already approved.
     *
     * TODO: Make sessionId required once all callers are updated to pass it
     * Command approvals always happen during tool execution which has session context
     *
     * @example
     * ```typescript
     * // bash_exec tool is approved, but dangerous commands still require approval
     * const response = await manager.requestCommandApproval({
     *   toolName: 'bash_exec',
     *   command: 'rm -rf /important',
     *   originalCommand: 'rm -rf /important',
     *   sessionId: 'session-123'
     * });
     * ```
     */
    async requestCommandApproval(
        metadata: CommandApprovalMetadata & {
            sessionId?: string;
            hostRuntime?: ApprovalRequestDetails['hostRuntime'];
            timeout?: number;
        }
    ): Promise<ApprovalResponse> {
        const { sessionId, hostRuntime, timeout, ...commandMetadata } = metadata;
        return this.requestApproval(
            this.createApprovalDetails(
                ApprovalType.COMMAND_APPROVAL,
                commandMetadata,
                sessionId,
                hostRuntime,
                timeout
            )
        );
    }

    /**
     * Request elicitation from MCP server
     * Convenience method for MCP elicitation requests
     *
     * Note: sessionId is optional because MCP servers are shared across sessions
     * and the MCP protocol doesn't include session context in elicitation requests.
     */
    async requestElicitation(
        metadata: ElicitationMetadata & {
            sessionId?: string;
            hostRuntime?: ApprovalRequestDetails['hostRuntime'];
            timeout?: number;
        }
    ): Promise<ApprovalResponse> {
        const { sessionId, hostRuntime, timeout, ...elicitationMetadata } = metadata;
        return this.requestApproval(
            this.createApprovalDetails(
                ApprovalType.ELICITATION,
                elicitationMetadata,
                sessionId,
                hostRuntime,
                timeout
            )
        );
    }

    /**
     * Check if tool approval was approved
     * Throws appropriate error if denied
     */
    async checkToolApproval(
        metadata: ToolApprovalMetadata & {
            sessionId?: string;
            hostRuntime?: ApprovalRequestDetails['hostRuntime'];
            timeout?: number;
        }
    ): Promise<boolean> {
        const response = await this.requestToolApproval(metadata);

        if (response.status === ApprovalStatus.APPROVED) {
            return true;
        } else if (response.status === ApprovalStatus.DENIED) {
            throw ApprovalError.toolApprovalDenied(
                metadata.toolName,
                response.reason,
                response.message,
                metadata.sessionId
            );
        } else {
            throw ApprovalError.cancelled(
                response.approvalId,
                ApprovalType.TOOL_APPROVAL,
                response.message ?? response.reason
            );
        }
    }

    /**
     * Get elicitation form data
     * Throws appropriate error if denied or cancelled
     */
    async getElicitationData(
        metadata: ElicitationMetadata & {
            sessionId?: string;
            hostRuntime?: ApprovalRequestDetails['hostRuntime'];
            timeout?: number;
        }
    ): Promise<Record<string, unknown>> {
        const response = await this.requestElicitation(metadata);

        if (response.status === ApprovalStatus.APPROVED) {
            return this.getElicitationFormData(response);
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
     * Get full pending approval requests
     */
    getPendingApprovalRequests(): ApprovalRequest[] {
        return this.handler?.getPendingRequests?.() ?? [];
    }

    /**
     * Auto-approve pending requests that match a predicate.
     * Used when a remembered approval should auto-approve other parallel requests
     * selected by the caller.
     *
     * @param predicate Function that returns true for requests that should be auto-approved
     * @param responseData Optional data to include in the auto-approval response
     * @returns Number of requests that were auto-approved
     */
    autoApprovePendingRequests(
        predicate: (request: ApprovalRequest) => boolean,
        responseData?: Record<string, unknown>
    ): number {
        const count = this.handler?.autoApprovePending?.(predicate, responseData) ?? 0;
        if (count > 0) {
            this.logger.info(
                `Auto-approved ${count} pending request(s) due to remembered approval`
            );
        }
        return count;
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
     * The handler will be called for:
     * - Tool approval requests when permissions.mode is 'manual'
     * - All elicitation requests (when elicitation is enabled, regardless of permissions.mode)
     *
     * A handler must be set before processing requests if:
     * - permissions.mode is 'manual', or
     * - elicitation is enabled (elicitation.enabled is true)
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
                    '  • manual tool approval mode\n' +
                    '  • all elicitation requests (when elicitation is enabled)\n' +
                    'Either:\n' +
                    '  • set permissions.mode to "auto-approve", or\n' +
                    '  • disable elicitation (set elicitation.enabled: false), or\n' +
                    '  • call agent.setApprovalHandler(...) before processing requests.'
            );
        }
        return this.handler;
    }
}
