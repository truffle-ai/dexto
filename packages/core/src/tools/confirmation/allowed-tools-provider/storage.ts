import type { StorageManager } from '../../../storage/index.js';
import type { AllowedToolsProvider } from './types.js';
import type { Logger } from '../../../logger/v2/types.js';
import { ToolError } from '../../errors.js';

/**
 * Storage-backed implementation that persists allowed tools in the Dexto
 * storage manager. The key scheme is:
 *   allowedTools:<sessionId>          – approvals scoped to a session
 *
 * Using the database backend for persistence.
 */
export class StorageAllowedToolsProvider implements AllowedToolsProvider {
    private logger: Logger;

    constructor(
        private storageManager: StorageManager,
        logger: Logger
    ) {
        this.logger = logger;
    }

    private buildKey(sessionId: string | undefined) {
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
            throw ToolError.validationFailed(
                'tool_approval_memory',
                'sessionId is required for remembered tool approvals'
            );
        }

        return `allowedTools:${sessionId}`;
    }

    async allowTool(toolName: string, sessionId: string): Promise<void> {
        const key = this.buildKey(sessionId);
        this.logger.debug(`Adding allowed tool '${toolName}' for key '${key}'`);

        // Persist as a plain string array to avoid JSON <-> Set issues across backends
        const existingRaw = await this.storageManager.getDatabase().get<string[]>(key);
        const newSet = new Set<string>(Array.isArray(existingRaw) ? existingRaw : []);
        newSet.add(toolName);

        // Store a fresh array copy – never the live Set instance
        await this.storageManager.getDatabase().set(key, Array.from(newSet));
        this.logger.debug(`Added allowed tool '${toolName}' for key '${key}'`);
    }

    async disallowTool(toolName: string, sessionId: string): Promise<void> {
        const key = this.buildKey(sessionId);
        this.logger.debug(`Removing allowed tool '${toolName}' for key '${key}'`);

        const existingRaw = await this.storageManager.getDatabase().get<string[]>(key);
        if (!Array.isArray(existingRaw)) return;

        const newSet = new Set<string>(existingRaw);
        newSet.delete(toolName);
        await this.storageManager.getDatabase().set(key, Array.from(newSet));
    }

    async isToolAllowed(toolName: string, sessionId: string): Promise<boolean> {
        const sessionArr = await this.storageManager
            .getDatabase()
            .get<string[]>(this.buildKey(sessionId));
        const allowed = Array.isArray(sessionArr) ? sessionArr.includes(toolName) : false;
        this.logger.debug(
            `Checked allowed tool '${toolName}' in session '${sessionId}' – allowed=${allowed}`
        );
        return allowed;
    }

    async getAllowedTools(sessionId: string): Promise<Set<string>> {
        const arr = await this.storageManager.getDatabase().get<string[]>(this.buildKey(sessionId));
        return new Set<string>(Array.isArray(arr) ? arr : []);
    }
}
