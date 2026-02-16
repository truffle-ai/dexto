import path from 'node:path';
import type {
    ApprovalHandler,
    ApprovalRequest,
    ApprovalResponse,
    ApprovalRequestDetails,
    ToolConfirmationMetadata,
    CommandConfirmationMetadata,
    ElicitationMetadata,
    DirectoryAccessMetadata,
} from './types.js';
import { ApprovalType, ApprovalStatus, DenialReason } from './types.js';
import { createApprovalRequest } from './factory.js';
import type { Logger } from '../logger/v2/types.js';
import { DextoLogComponent } from '../logger/v2/types.js';
import { ApprovalError } from './errors.js';
import { patternCovers } from '../tools/pattern-utils.js';
import type { PermissionsMode } from '../tools/schemas.js';

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
 *   { permissions: { mode: 'manual', timeout: 60000 }, elicitation: { enabled: true, timeout: 60000 } },
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
    private logger: Logger;

    /**
     * Tool approval patterns, keyed by tool id.
     *
     * Patterns use simple glob syntax (e.g. "git *", "npm install *") and are matched
     * using pattern-to-pattern covering (see {@link patternCovers}).
     */
    private toolPatterns: Map<string, Set<string>> = new Map();

    /**
     * Directories approved for file access for the current session.
     * Stores normalized absolute paths mapped to their approval type:
     * - 'session': No directory prompt, follows tool config (working dir + user session-approved)
     * - 'once': Prompts each time, but tool can execute
     * Cleared when session ends.
     */
    private approvedDirectories: Map<string, 'session' | 'once'> = new Map();

    constructor(config: ApprovalManagerConfig, logger: Logger) {
        this.config = config;
        this.logger = logger.createChild(DextoLogComponent.APPROVAL);

        this.logger.debug(
            `ApprovalManager initialized with permissions.mode: ${config.permissions.mode}, elicitation.enabled: ${config.elicitation.enabled}`
        );
    }

    // ==================== Pattern Methods ====================

    private getOrCreateToolPatternSet(toolName: string): Set<string> {
        const existing = this.toolPatterns.get(toolName);
        if (existing) return existing;
        const created = new Set<string>();
        this.toolPatterns.set(toolName, created);
        return created;
    }

    /**
     * Add an approval pattern for a tool.
     */
    addPattern(toolName: string, pattern: string): void {
        this.getOrCreateToolPatternSet(toolName).add(pattern);
        this.logger.debug(`Added pattern for '${toolName}': "${pattern}"`);
    }

    /**
     * Check if a pattern key is covered by any approved pattern for a tool.
     *
     * Note: This expects a pattern key (e.g. "git push *"), not raw arguments.
     * Tools are responsible for generating the key via Tool.getApprovalPatternKey().
     */
    matchesPattern(toolName: string, patternKey: string): boolean {
        const patterns = this.toolPatterns.get(toolName);
        if (!patterns || patterns.size === 0) return false;

        for (const storedPattern of patterns) {
            if (patternCovers(storedPattern, patternKey)) {
                this.logger.debug(
                    `Pattern key "${patternKey}" is covered by approved pattern "${storedPattern}" (tool: ${toolName})`
                );
                return true;
            }
        }
        return false;
    }

    /**
     * Clear all patterns for a tool (or all tools when omitted).
     */
    clearPatterns(toolName?: string): void {
        if (toolName) {
            const patterns = this.toolPatterns.get(toolName);
            if (!patterns) return;
            const count = patterns.size;
            patterns.clear();
            if (count > 0) {
                this.logger.debug(`Cleared ${count} pattern(s) for '${toolName}'`);
            }
            return;
        }

        const count = Array.from(this.toolPatterns.values()).reduce(
            (sum, set) => sum + set.size,
            0
        );
        this.toolPatterns.clear();
        if (count > 0) {
            this.logger.debug(`Cleared ${count} total tool pattern(s)`);
        }
    }

    /**
     * Get patterns for a tool (for debugging/display).
     */
    getToolPatterns(toolName: string): ReadonlySet<string> {
        return this.toolPatterns.get(toolName) ?? new Set<string>();
    }

    /**
     * Get all tool patterns (for debugging/display).
     */
    getAllToolPatterns(): ReadonlyMap<string, Set<string>> {
        return this.toolPatterns;
    }

    // ==================== Directory Access Methods ====================

    /**
     * Initialize the working directory as a session-approved directory.
     * This should be called once during setup to ensure the working directory
     * never triggers directory access prompts.
     *
     * @param workingDir The working directory path
     */
    initializeWorkingDirectory(workingDir: string): void {
        const normalized = path.resolve(workingDir);
        this.approvedDirectories.set(normalized, 'session');
        this.logger.debug(`Initialized working directory as session-approved: "${normalized}"`);
    }

    /**
     * Add a directory to the approved list for this session.
     * Files within this directory (including subdirectories) will be allowed.
     *
     * @param directory Absolute path to the directory to approve
     * @param type The approval type:
     *   - 'session': No directory prompt on future accesses, follows tool config
     *   - 'once': Will prompt again on future accesses, but tool can execute this time
     * @example
     * ```typescript
     * manager.addApprovedDirectory("/external/project", 'session');
     * // Now /external/project/src/file.ts is accessible without directory prompt
     *
     * manager.addApprovedDirectory("/tmp/files", 'once');
     * // Tool can access, but will prompt again next time
     * ```
     */
    addApprovedDirectory(directory: string, type: 'session' | 'once' = 'session'): void {
        const normalized = path.resolve(directory);
        const existing = this.approvedDirectories.get(normalized);

        // Don't downgrade from 'session' to 'once'
        if (existing === 'session') {
            this.logger.debug(
                `Directory "${normalized}" already approved as 'session', not downgrading to '${type}'`
            );
            return;
        }

        this.approvedDirectories.set(normalized, type);
        this.logger.debug(`Added approved directory: "${normalized}" (type: ${type})`);
    }

    /**
     * Check if a file path is within any session-approved directory.
     * This is used for PROMPTING decisions - only 'session' type directories count.
     * Working directory and user session-approved directories return true.
     *
     * @param filePath The file path to check (can be relative or absolute)
     * @returns true if the path is within a session-approved directory
     */
    isDirectorySessionApproved(filePath: string): boolean {
        const normalized = path.resolve(filePath);

        for (const [approvedDir, type] of this.approvedDirectories) {
            // Only check 'session' type directories for prompting decisions
            if (type !== 'session') continue;

            const relative = path.relative(approvedDir, normalized);
            if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
                this.logger.debug(
                    `Path "${normalized}" is within session-approved directory "${approvedDir}"`
                );
                return true;
            }
        }
        return false;
    }

    /**
     * Check if a file path is within any approved directory (session OR once).
     * This is used for EXECUTION decisions - both 'session' and 'once' types count.
     * PathValidator uses this to determine if a tool can access the path.
     *
     * @param filePath The file path to check (can be relative or absolute)
     * @returns true if the path is within any approved directory
     */
    isDirectoryApproved(filePath: string): boolean {
        const normalized = path.resolve(filePath);

        for (const [approvedDir] of this.approvedDirectories) {
            const relative = path.relative(approvedDir, normalized);
            if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
                this.logger.debug(
                    `Path "${normalized}" is within approved directory "${approvedDir}"`
                );
                return true;
            }
        }
        return false;
    }

    /**
     * Clear all approved directories.
     * Should be called when session ends.
     */
    clearApprovedDirectories(): void {
        const count = this.approvedDirectories.size;
        this.approvedDirectories.clear();
        if (count > 0) {
            this.logger.debug(`Cleared ${count} approved directories`);
        }
    }

    /**
     * Get the current map of approved directories with their types (for debugging/display).
     */
    getApprovedDirectories(): ReadonlyMap<string, 'session' | 'once'> {
        return this.approvedDirectories;
    }

    /**
     * Get just the directory paths that are approved (for debugging/display).
     */
    getApprovedDirectoryPaths(): string[] {
        return Array.from(this.approvedDirectories.keys());
    }

    /**
     * Clear all session-scoped approvals (tool patterns and directories).
     * Convenience method for clearing all session state at once.
     */
    clearSessionApprovals(): void {
        this.clearPatterns();
        this.clearApprovedDirectories();
        this.logger.debug('Cleared all session approvals');
    }

    /**
     * Request directory access approval.
     * Convenience method for directory access requests.
     *
     * @example
     * ```typescript
     * const response = await manager.requestDirectoryAccess({
     *   path: '/external/project/src/file.ts',
     *   parentDir: '/external/project',
     *   operation: 'write',
     *   toolName: 'write_file',
     *   sessionId: 'session-123'
     * });
     * ```
     */
    async requestDirectoryAccess(
        metadata: DirectoryAccessMetadata & { sessionId?: string; timeout?: number }
    ): Promise<ApprovalResponse> {
        const { sessionId, timeout, ...directoryMetadata } = metadata;

        const details: ApprovalRequestDetails = {
            type: ApprovalType.DIRECTORY_ACCESS,
            // Use provided timeout, fallback to config timeout, or undefined (no timeout)
            timeout: timeout !== undefined ? timeout : this.config.permissions.timeout,
            metadata: directoryMetadata,
        };

        if (sessionId !== undefined) {
            details.sessionId = sessionId;
        }

        return this.requestApproval(details);
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
     * Handle approval requests (tool confirmation, elicitation, command confirmation, directory access, custom)
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

        // Tool/command/directory-access/custom confirmations respect the configured mode
        const mode = this.config.permissions.mode;

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
     *
     * TODO: Make sessionId required once all callers are updated to pass it
     * Tool confirmations always happen in session context during LLM execution
     */
    async requestToolConfirmation(
        metadata: ToolConfirmationMetadata & { sessionId?: string; timeout?: number }
    ): Promise<ApprovalResponse> {
        const { sessionId, timeout, ...toolMetadata } = metadata;

        const details: ApprovalRequestDetails = {
            type: ApprovalType.TOOL_CONFIRMATION,
            // Use provided timeout, fallback to config timeout, or undefined (no timeout)
            timeout: timeout !== undefined ? timeout : this.config.permissions.timeout,
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
     * TODO: Make sessionId required once all callers are updated to pass it
     * Command confirmations always happen during tool execution which has session context
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
            // Use provided timeout, fallback to config timeout, or undefined (no timeout)
            timeout: timeout !== undefined ? timeout : this.config.permissions.timeout,
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
            // Use provided timeout, fallback to config timeout, or undefined (no timeout)
            timeout: timeout !== undefined ? timeout : this.config.elicitation.timeout,
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
     * Get full pending approval requests
     */
    getPendingApprovalRequests(): ApprovalRequest[] {
        return this.handler?.getPendingRequests?.() ?? [];
    }

    /**
     * Auto-approve pending requests that match a predicate.
     * Used when a pattern is remembered to auto-approve other parallel requests
     * that would now match the same pattern.
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
            this.logger.info(`Auto-approved ${count} pending request(s) due to matching pattern`);
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
     * - Tool confirmation requests when permissions.mode is 'manual'
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
                    '  • manual tool confirmation mode\n' +
                    '  • all elicitation requests (when elicitation is enabled)\n' +
                    'Either:\n' +
                    '  • set permissions.mode to "auto-approve" or "auto-deny", or\n' +
                    '  • disable elicitation (set elicitation.enabled: false), or\n' +
                    '  • call agent.setApprovalHandler(...) before processing requests.'
            );
        }
        return this.handler;
    }
}
