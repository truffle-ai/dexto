import type { Logger } from '../../logger/v2/types.js';
import type {
    SessionToolPreferences,
    SessionToolPreferencesStore,
} from '../session-tool-preferences-store.js';
import type { ToolSet } from '../types.js';

const MCP_TOOL_PREFIX = 'mcp--';
type SessionToolPreferencesStorage = Pick<SessionToolPreferencesStore, 'load' | 'save' | 'delete'>;

export function matchesToolPolicyPattern(toolName: string, policyPattern: string): boolean {
    if (toolName === policyPattern) {
        return true;
    }

    if (!policyPattern.startsWith(MCP_TOOL_PREFIX)) {
        return false;
    }

    const baseName = policyPattern.substring(MCP_TOOL_PREFIX.length);
    return toolName.endsWith(`--${baseName}`) && toolName.startsWith(MCP_TOOL_PREFIX);
}

export class SessionToolPolicy {
    private sessionAutoApproveTools: Map<string, string[]> = new Map();
    private sessionUserAutoApproveTools: Map<string, string[]> = new Map();
    private sessionDisabledTools: Map<string, string[]> = new Map();
    private readonly restoredSessionPreferences = new Set<string>();
    private readonly sessionPreferenceLocks = new Map<string, Promise<void>>();
    private globalDisabledTools: string[] = [];

    constructor(
        private readonly preferencesStore: SessionToolPreferencesStorage,
        private readonly logger: Logger,
        private readonly normalizePattern: (pattern: string) => string
    ) {}

    async restoreSessionState(sessionId: string): Promise<void> {
        if (this.restoredSessionPreferences.has(sessionId)) {
            return;
        }

        await this.runWithSessionPreferenceLock(sessionId, async () => {
            if (this.restoredSessionPreferences.has(sessionId)) {
                return;
            }

            const preferences = await this.preferencesStore.load(sessionId);
            this.applySessionToolPreferences(sessionId, preferences);
            this.restoredSessionPreferences.add(sessionId);

            this.logger.debug('Restored persisted session tool preferences', {
                sessionId,
                autoApproveCount: preferences.userAutoApproveTools.length,
                disabledCount: preferences.disabledTools.length,
            });
        });
    }

    evictSessionState(sessionId: string): void {
        this.sessionAutoApproveTools.delete(sessionId);
        this.sessionUserAutoApproveTools.delete(sessionId);
        this.sessionDisabledTools.delete(sessionId);
        this.restoredSessionPreferences.delete(sessionId);
    }

    async deleteSessionState(sessionId: string): Promise<void> {
        await this.runWithSessionPreferenceLock(sessionId, async () => {
            this.evictSessionState(sessionId);
            await this.preferencesStore.delete(sessionId);
        });
    }

    setSessionAutoApproveTools(sessionId: string, autoApproveTools: string[]): void {
        if (autoApproveTools.length === 0) {
            this.clearSessionAutoApproveTools(sessionId);
            return;
        }

        const normalized = autoApproveTools.map(this.normalizePattern);
        this.sessionAutoApproveTools.set(sessionId, normalized);
        this.logger.info(
            `Session auto-approve tools set for '${sessionId}': ${autoApproveTools.length} tools`
        );
        this.logger.debug(`Auto-approve tools: ${normalized.join(', ')}`);
    }

    addSessionAutoApproveTools(sessionId: string, autoApproveTools: string[]): void {
        if (autoApproveTools.length === 0) {
            return;
        }

        const normalized = autoApproveTools.map(this.normalizePattern);
        const existing = this.sessionAutoApproveTools.get(sessionId) ?? [];
        const merged = [...existing];
        const seen = new Set(existing);

        for (const toolName of normalized) {
            if (seen.has(toolName)) {
                continue;
            }
            merged.push(toolName);
            seen.add(toolName);
        }

        const actuallyAdded = Math.max(0, merged.length - existing.length);
        this.sessionAutoApproveTools.set(sessionId, merged);
        this.logger.info(
            `Session auto-approve tools updated for '${sessionId}': +${actuallyAdded} tools`
        );
        this.logger.debug(`Auto-approve tools: ${merged.join(', ')}`);
    }

    async setSessionUserAutoApproveTools(
        sessionId: string,
        autoApproveTools: string[]
    ): Promise<void> {
        await this.restoreSessionState(sessionId);
        if (autoApproveTools.length === 0) {
            await this.clearSessionUserAutoApproveTools(sessionId);
            return;
        }

        const normalized = autoApproveTools.map(this.normalizePattern);

        await this.runWithSessionPreferenceLock(sessionId, async () => {
            this.sessionUserAutoApproveTools.set(sessionId, normalized);
            await this.persistSessionToolPreferences(sessionId);
        });

        this.logger.info(
            `Session user auto-approve tools set for '${sessionId}': ${autoApproveTools.length} tools`
        );
        this.logger.debug(`User auto-approve tools: ${normalized.join(', ')}`);
    }

    async clearSessionUserAutoApproveTools(sessionId: string): Promise<void> {
        await this.restoreSessionState(sessionId);

        let hadAutoApprove = false;
        await this.runWithSessionPreferenceLock(sessionId, async () => {
            hadAutoApprove = this.sessionUserAutoApproveTools.has(sessionId);
            this.sessionUserAutoApproveTools.delete(sessionId);
            await this.persistSessionToolPreferences(sessionId);
        });

        if (hadAutoApprove) {
            this.logger.info(`Session user auto-approve tools cleared for '${sessionId}'`);
        }
    }

    clearSessionAutoApproveTools(sessionId: string): void {
        const hadAutoApprove = this.sessionAutoApproveTools.has(sessionId);
        this.sessionAutoApproveTools.delete(sessionId);
        if (hadAutoApprove) {
            this.logger.info(`Session auto-approve tools cleared for '${sessionId}'`);
        }
    }

    hasSessionUserAutoApproveTools(sessionId: string): boolean {
        return this.sessionUserAutoApproveTools.has(sessionId);
    }

    setGlobalDisabledTools(toolNames: string[]): void {
        this.globalDisabledTools = [...toolNames];
        this.logger.info('Global disabled tools updated', {
            count: toolNames.length,
        });
    }

    getGlobalDisabledTools(): string[] {
        return [...this.globalDisabledTools];
    }

    async setSessionDisabledTools(sessionId: string, toolNames: string[]): Promise<void> {
        await this.restoreSessionState(sessionId);
        if (toolNames.length === 0) {
            await this.clearSessionDisabledTools(sessionId);
            return;
        }

        await this.runWithSessionPreferenceLock(sessionId, async () => {
            this.sessionDisabledTools.set(sessionId, [...toolNames]);
            await this.persistSessionToolPreferences(sessionId);
        });

        this.logger.info('Session disabled tools updated', {
            sessionId,
            count: toolNames.length,
        });
    }

    async clearSessionDisabledTools(sessionId: string): Promise<void> {
        await this.restoreSessionState(sessionId);

        let hadOverrides = false;
        await this.runWithSessionPreferenceLock(sessionId, async () => {
            hadOverrides = this.sessionDisabledTools.has(sessionId);
            this.sessionDisabledTools.delete(sessionId);
            await this.persistSessionToolPreferences(sessionId);
        });

        if (hadOverrides) {
            this.logger.info('Session disabled tools cleared', { sessionId });
        }
    }

    getDisabledTools(sessionId?: string): string[] {
        if (sessionId && this.sessionDisabledTools.has(sessionId)) {
            return this.sessionDisabledTools.get(sessionId) ?? [];
        }

        return this.globalDisabledTools;
    }

    filterToolsForSession(toolSet: ToolSet, sessionId?: string): ToolSet {
        const disabled = new Set(this.getDisabledTools(sessionId));
        if (disabled.size === 0) {
            return toolSet;
        }

        return Object.fromEntries(
            Object.entries(toolSet).filter(([toolName]) => !disabled.has(toolName))
        );
    }

    hasSessionAutoApproveTools(sessionId: string): boolean {
        return this.sessionAutoApproveTools.has(sessionId);
    }

    getSessionAutoApproveTools(sessionId: string): string[] | undefined {
        return this.sessionAutoApproveTools.get(sessionId);
    }

    getSessionUserAutoApproveTools(sessionId: string): string[] | undefined {
        return this.sessionUserAutoApproveTools.get(sessionId);
    }

    getCombinedSessionAutoApproveTools(sessionId: string): string[] {
        return [
            ...(this.sessionAutoApproveTools.get(sessionId) ?? []),
            ...(this.sessionUserAutoApproveTools.get(sessionId) ?? []),
        ];
    }

    isToolAutoApprovedForSession(sessionId: string, toolName: string): boolean {
        const autoApproveTools = this.getCombinedSessionAutoApproveTools(sessionId);
        if (autoApproveTools.length === 0) {
            return false;
        }

        return autoApproveTools.some((pattern) => matchesToolPolicyPattern(toolName, pattern));
    }

    private async runWithSessionPreferenceLock<T>(
        sessionId: string,
        fn: () => Promise<T>
    ): Promise<T> {
        const previousLock = this.sessionPreferenceLocks.get(sessionId) ?? Promise.resolve();
        const currentResult = previousLock.catch(() => {}).then(() => fn());
        const currentLock = currentResult.then(
            () => undefined,
            () => undefined
        );

        this.sessionPreferenceLocks.set(sessionId, currentLock);

        try {
            return await currentResult;
        } finally {
            if (this.sessionPreferenceLocks.get(sessionId) === currentLock) {
                this.sessionPreferenceLocks.delete(sessionId);
            }
        }
    }

    private applySessionToolPreferences(
        sessionId: string,
        preferences: SessionToolPreferences
    ): void {
        if (preferences.userAutoApproveTools.length > 0) {
            this.sessionUserAutoApproveTools.set(sessionId, [...preferences.userAutoApproveTools]);
        } else {
            this.sessionUserAutoApproveTools.delete(sessionId);
        }
        if (preferences.disabledTools.length > 0) {
            this.sessionDisabledTools.set(sessionId, [...preferences.disabledTools]);
        } else {
            this.sessionDisabledTools.delete(sessionId);
        }
    }

    private getSessionToolPreferencesSnapshot(sessionId: string): SessionToolPreferences {
        return {
            userAutoApproveTools: [...(this.sessionUserAutoApproveTools.get(sessionId) ?? [])],
            disabledTools: [...(this.sessionDisabledTools.get(sessionId) ?? [])],
        };
    }

    private async persistSessionToolPreferences(sessionId: string): Promise<void> {
        await this.preferencesStore.save(
            sessionId,
            this.getSessionToolPreferencesSnapshot(sessionId)
        );
    }
}
