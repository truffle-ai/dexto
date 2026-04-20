import path from 'node:path';
import { realpathSync } from 'node:fs';
import type {
    ApprovalHandler,
    ApprovalRequest,
    ApprovalResponse,
    ApprovalRequestDetails,
    ToolApprovalMetadata,
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
import {
    SessionApprovalStore,
    type PersistedApprovedDirectory,
    type SessionApprovalState,
} from './session-approval-store.js';

const GLOBAL_APPROVAL_SCOPE = '__global__';

type ApprovalScopeState = {
    toolPatterns: Map<string, Set<string>>;
    approvedDirectories: Map<string, 'session' | 'once'>;
};

function tryRealpathSync(targetPath: string): string | null {
    try {
        return realpathSync(targetPath);
    } catch {
        return null;
    }
}

function tryRealpathSyncWithExistingParent(resolvedPath: string): string | null {
    const direct = tryRealpathSync(resolvedPath);
    if (direct) return direct;

    let currentDir = path.dirname(resolvedPath);
    while (true) {
        const realDir = tryRealpathSync(currentDir);
        if (realDir) {
            const suffix = path.relative(currentDir, resolvedPath);
            return path.join(realDir, suffix);
        }

        const parent = path.dirname(currentDir);
        if (parent === currentDir) {
            return null;
        }
        currentDir = parent;
    }
}

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
 * - Support multiple approval modes (manual, auto-approve, auto-deny)
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
    private readonly scopes = new Map<string, ApprovalScopeState>();

    constructor(
        config: ApprovalManagerConfig,
        logger: Logger,
        private readonly sessionApprovalStore: SessionApprovalStore
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
            toolPatterns: new Map(),
            approvedDirectories: new Map(),
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

    private snapshotToolPatterns(scopeKey: string): Record<string, string[]> {
        const snapshot: Record<string, string[]> = {};
        for (const [toolName, patterns] of this.getScope(scopeKey).toolPatterns) {
            snapshot[toolName] = Array.from(patterns);
        }
        return snapshot;
    }

    private snapshotApprovedDirectories(scopeKey: string): PersistedApprovedDirectory[] {
        return Array.from(this.getScope(scopeKey).approvedDirectories.entries()).map(
            ([path, type]) => ({
                path,
                type,
            })
        );
    }

    private async persistScope(sessionId?: string): Promise<void> {
        const scopeKey = this.getScopeKey(sessionId);
        const state: SessionApprovalState = {
            toolPatterns: this.snapshotToolPatterns(scopeKey),
            approvedDirectories: this.snapshotApprovedDirectories(scopeKey),
        };
        await this.sessionApprovalStore.save(sessionId, state);
    }

    private hydrateScope(sessionId: string | undefined, state: SessionApprovalState): void {
        const scopeKey = this.getScopeKey(sessionId);

        const toolPatterns = new Map<string, Set<string>>();
        for (const [toolName, patterns] of Object.entries(state.toolPatterns)) {
            toolPatterns.set(toolName, new Set(patterns));
        }

        const approvedDirectories = new Map<string, 'session' | 'once'>();
        for (const entry of state.approvedDirectories) {
            approvedDirectories.set(entry.path, entry.type);
        }

        this.scopes.set(scopeKey, {
            toolPatterns,
            approvedDirectories,
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

            const state = await this.sessionApprovalStore.load(sessionId);
            this.hydrateScope(sessionId, state);
            this.loadedScopes.add(scopeKey);

            this.logger.debug('Restored persisted approval state', {
                sessionId: this.getScopeLabel(sessionId),
                toolCount: Object.keys(state.toolPatterns).length,
                directoryCount: state.approvedDirectories.length,
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
            await this.sessionApprovalStore.delete(sessionId);
        });
    }

    // ==================== Pattern Methods ====================

    private getOrCreateToolPatternSet(toolName: string, scopeKey: string): Set<string> {
        const scope = this.getOrCreateScope(scopeKey).toolPatterns;
        const existing = scope.get(toolName);
        if (existing) return existing;
        const created = new Set<string>();
        scope.set(toolName, created);
        return created;
    }

    /**
     * Add an approval pattern for a tool.
     */
    async addPattern(toolName: string, pattern: string, sessionId?: string): Promise<void> {
        await this.restoreSessionState(sessionId);
        const scopeKey = this.getScopeKey(sessionId);

        await this.runWithScopeLock(scopeKey, async () => {
            this.getOrCreateToolPatternSet(toolName, scopeKey).add(pattern);
            await this.persistScope(sessionId);
        });

        this.logger.debug(
            `Added pattern for '${toolName}' in '${this.getScopeLabel(sessionId)}': "${pattern}"`
        );
    }

    /**
     * Check if a pattern key is covered by any approved pattern for a tool.
     *
     * Note: This expects a pattern key (e.g. "git push *"), not raw arguments.
     * Tools are responsible for generating the key via `tool.approval.patternKey()`.
     */
    matchesPattern(toolName: string, patternKey: string, sessionId?: string): boolean {
        const scopeKey = this.getScopeKey(sessionId);
        const patterns = this.getScope(scopeKey).toolPatterns.get(toolName);
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
    async clearPatterns(toolName?: string, sessionId?: string): Promise<void> {
        await this.restoreSessionState(sessionId);
        const scopeKey = this.getScopeKey(sessionId);

        await this.runWithScopeLock(scopeKey, async () => {
            const scope = this.getOrCreateScope(scopeKey).toolPatterns;
            if (toolName) {
                const patterns = scope.get(toolName);
                if (!patterns) return;
                const count = patterns.size;
                scope.delete(toolName);
                await this.persistScope(sessionId);
                if (count > 0) {
                    this.logger.debug(
                        `Cleared ${count} pattern(s) for '${toolName}' in '${this.getScopeLabel(sessionId)}'`
                    );
                }
                return;
            }

            const count = Array.from(scope.values()).reduce((sum, set) => sum + set.size, 0);
            scope.clear();
            await this.persistScope(sessionId);
            if (count > 0) {
                this.logger.debug(
                    `Cleared ${count} total tool pattern(s) in '${this.getScopeLabel(sessionId)}'`
                );
            }
        });
    }

    /**
     * Get patterns for a tool (for debugging/display).
     */
    getToolPatterns(toolName: string, sessionId?: string): ReadonlySet<string> {
        const scopeKey = this.getScopeKey(sessionId);
        return this.getScope(scopeKey).toolPatterns.get(toolName) ?? new Set<string>();
    }

    /**
     * Get all tool patterns (for debugging/display).
     */
    getAllToolPatterns(sessionId?: string): ReadonlyMap<string, Set<string>> {
        const scopeKey = this.getScopeKey(sessionId);
        return this.getScope(scopeKey).toolPatterns;
    }

    // ==================== Directory Access Methods ====================

    /**
     * Resolve a directory path for use as an approval key.
     *
     * We store BOTH the resolved path and (when available) its realpath, so approvals
     * continue to work even when other subsystems canonicalize paths via realpath
     * (e.g. macOS /tmp -> /private/tmp or custom symlinked directories).
     */
    private getPathApprovalKeys(targetPath: string): string[] {
        const resolved = path.resolve(targetPath);
        const real = tryRealpathSyncWithExistingParent(resolved);
        if (real && real !== resolved) {
            return [resolved, real];
        }
        return [resolved];
    }

    private isPathWithinApprovedDirectory(
        targetPath: string,
        sessionId: string | undefined,
        approvedTypes: ReadonlySet<'session' | 'once'>
    ): boolean {
        const scopeKey = this.getScopeKey(sessionId);
        const directoryScope = this.getScope(scopeKey).approvedDirectories;
        for (const normalized of this.getPathApprovalKeys(targetPath)) {
            for (const [approvedDir, type] of directoryScope) {
                if (!approvedTypes.has(type)) {
                    continue;
                }

                const relative = path.relative(approvedDir, normalized);
                if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
                    this.logger.debug(
                        `Path "${normalized}" is within approved directory "${approvedDir}" (type: ${type})`
                    );
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Initialize the working directory as a session-approved directory.
     * This should be called once during setup to ensure the working directory
     * never triggers directory access prompts.
     *
     * @param workingDir The working directory path
     */
    async initializeWorkingDirectory(workingDir: string, sessionId?: string): Promise<void> {
        await this.addApprovedDirectory(workingDir, 'session', sessionId);
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
    async addApprovedDirectory(
        directory: string,
        type: 'session' | 'once' = 'session',
        sessionId?: string
    ): Promise<void> {
        await this.restoreSessionState(sessionId);
        const scopeKey = this.getScopeKey(sessionId);

        await this.runWithScopeLock(scopeKey, async () => {
            const keys = this.getPathApprovalKeys(directory);
            const directoryScope = this.getOrCreateScope(scopeKey).approvedDirectories;

            const existingTypes = keys
                .map((key) => directoryScope.get(key))
                .filter((value): value is 'session' | 'once' => value !== undefined);
            const hasSessionApproval = existingTypes.includes('session');

            // Never downgrade from session to once, even across realpath aliases
            const effectiveType: 'session' | 'once' =
                type === 'session' || hasSessionApproval ? 'session' : 'once';

            for (const key of keys) {
                const existing = directoryScope.get(key);
                if (existing === 'session') {
                    continue;
                }
                directoryScope.set(key, effectiveType);
            }

            await this.persistScope(sessionId);

            const resolvedKey = keys[0]!;
            if (effectiveType === 'session' && type === 'once' && hasSessionApproval) {
                this.logger.debug(
                    `Directory "${resolvedKey}" already approved as 'session', not downgrading to 'once'`
                );
                return;
            }

            const realKey = keys.length > 1 ? keys[1] : null;
            this.logger.debug(
                `Added approved directory in '${this.getScopeLabel(sessionId)}': "${resolvedKey}" (type: ${effectiveType})${
                    realKey ? `, realpath: "${realKey}"` : ''
                }`
            );
        });
    }

    /**
     * Check if a file path is within any session-approved directory.
     * This is used for PROMPTING decisions - only 'session' type directories count.
     * Working directory and user session-approved directories return true.
     *
     * @param filePath The file path to check (can be relative or absolute)
     * @returns true if the path is within a session-approved directory
     */
    isDirectorySessionApproved(filePath: string, sessionId?: string): boolean {
        return this.isPathWithinApprovedDirectory(filePath, sessionId, new Set(['session']));
    }

    /**
     * Check if a file path is within any approved directory (session OR once).
     * This is used for EXECUTION decisions - both 'session' and 'once' types count.
     * PathValidator uses this to determine if a tool can access the path.
     *
     * @param filePath The file path to check (can be relative or absolute)
     * @returns true if the path is within any approved directory
     */
    isDirectoryApproved(filePath: string, sessionId?: string): boolean {
        return this.isPathWithinApprovedDirectory(
            filePath,
            sessionId,
            new Set(['session', 'once'])
        );
    }

    /**
     * Clear all approved directories.
     * Should be called when session ends.
     */
    async clearApprovedDirectories(sessionId?: string): Promise<void> {
        await this.restoreSessionState(sessionId);
        const scopeKey = this.getScopeKey(sessionId);

        await this.runWithScopeLock(scopeKey, async () => {
            const scope = this.getOrCreateScope(scopeKey).approvedDirectories;
            const count = scope.size;
            scope.clear();
            await this.persistScope(sessionId);
            if (count > 0) {
                this.logger.debug(
                    `Cleared ${count} approved directories in '${this.getScopeLabel(sessionId)}'`
                );
            }
        });
    }

    /**
     * Get the current map of approved directories with their types (for debugging/display).
     */
    getApprovedDirectories(sessionId?: string): ReadonlyMap<string, 'session' | 'once'> {
        const scopeKey = this.getScopeKey(sessionId);
        return this.getScope(scopeKey).approvedDirectories;
    }

    /**
     * Get just the directory paths that are approved (for debugging/display).
     */
    getApprovedDirectoryPaths(sessionId?: string): string[] {
        return Array.from(this.getApprovedDirectories(sessionId).keys());
    }

    /**
     * Clear all session-scoped approvals (tool patterns and directories).
     * Convenience method for clearing all session state at once.
     */
    async clearSessionApprovals(sessionId?: string): Promise<void> {
        await this.restoreSessionState(sessionId);
        const scopeKey = this.getScopeKey(sessionId);

        await this.runWithScopeLock(scopeKey, async () => {
            const scope = this.getOrCreateScope(scopeKey);
            const patternCount = Array.from(scope.toolPatterns.values()).reduce(
                (sum, set) => sum + set.size,
                0
            );
            const directoryCount = scope.approvedDirectories.size;

            scope.toolPatterns.clear();
            scope.approvedDirectories.clear();
            await this.persistScope(sessionId);

            if (patternCount > 0 || directoryCount > 0) {
                this.logger.debug(
                    `Cleared ${patternCount} tool pattern(s) and ${directoryCount} approved director${directoryCount === 1 ? 'y' : 'ies'} in '${this.getScopeLabel(sessionId)}'`
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

    private createResponse(
        request: ApprovalRequest,
        response: Omit<ApprovalResponse, 'approvalId' | 'sessionId'>
    ): ApprovalResponse {
        return {
            approvalId: request.approvalId,
            ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
            ...(request.hostRuntime !== undefined ? { hostRuntime: request.hostRuntime } : {}),
            ...response,
        };
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
        metadata: DirectoryAccessMetadata & {
            sessionId?: string;
            hostRuntime?: ApprovalRequestDetails['hostRuntime'];
            timeout?: number;
        }
    ): Promise<ApprovalResponse> {
        const { sessionId, hostRuntime, timeout, ...directoryMetadata } = metadata;
        return this.requestApproval(
            this.createApprovalDetails(
                ApprovalType.DIRECTORY_ACCESS,
                directoryMetadata,
                sessionId,
                hostRuntime,
                timeout
            )
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
     * Handle approval requests (tool approval, elicitation, command confirmation, directory access, custom)
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
            return this.createResponse(request, {
                status: ApprovalStatus.APPROVED,
            });
        }

        // Auto-deny mode
        if (mode === 'auto-deny') {
            this.logger.info(
                `Auto-deny approval '${request.type}', approvalId: ${request.approvalId}`
            );
            return this.createResponse(request, {
                status: ApprovalStatus.DENIED,
                reason: DenialReason.SYSTEM_DENIED,
                message: `Approval automatically denied by system policy (auto-deny mode)`,
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
     * Tool confirmations always happen in session context during LLM execution
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
     * Request command confirmation approval
     * Convenience method for dangerous command execution within an already-approved tool
     *
     * This is different from tool approval - it's for per-command approval
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
        metadata: CommandConfirmationMetadata & {
            sessionId?: string;
            hostRuntime?: ApprovalRequestDetails['hostRuntime'];
            timeout?: number;
        }
    ): Promise<ApprovalResponse> {
        const { sessionId, hostRuntime, timeout, ...commandMetadata } = metadata;
        return this.requestApproval(
            this.createApprovalDetails(
                ApprovalType.COMMAND_CONFIRMATION,
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
                    '  • manual tool approval mode\n' +
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
