import type { StorageBackends } from '@core/storage/index.js';
import type { IAllowedToolsProvider } from './types.js';
import { logger } from '@core/logger/index.js';

/**
 * Storage-backed implementation that persists allowed tools in the Dexto
 * storage backends. The key scheme is:
 *   allowedTools:<sessionId>          – approvals scoped to a session
 *   allowedTools:global               – global approvals (sessionId undefined)
 *
 * Using the database backend for persistence.
 */
export class StorageAllowedToolsProvider implements IAllowedToolsProvider {
    constructor(private storage: StorageBackends) {}

    private buildKey(sessionId?: string) {
        return sessionId ? `allowedTools:${sessionId}` : 'allowedTools:global';
    }

    async allowTool(toolName: string, sessionId?: string): Promise<void> {
        const key = this.buildKey(sessionId);
        logger.debug(`Adding allowed tool '${toolName}' for key '${key}'`);

        // Persist as a plain string array to avoid JSON <-> Set issues across backends
        const existingRaw = await this.storage.database.get<string[]>(key);
        const newSet = new Set<string>(Array.isArray(existingRaw) ? existingRaw : []);
        newSet.add(toolName);

        // Store a fresh array copy – never the live Set instance
        await this.storage.database.set(key, Array.from(newSet));
        logger.debug(`Added allowed tool '${toolName}' for key '${key}'`);
    }

    async disallowTool(toolName: string, sessionId?: string): Promise<void> {
        const key = this.buildKey(sessionId);
        logger.debug(`Removing allowed tool '${toolName}' for key '${key}'`);

        const existingRaw = await this.storage.database.get<string[]>(key);
        if (!Array.isArray(existingRaw)) return;

        const newSet = new Set<string>(existingRaw);
        newSet.delete(toolName);
        await this.storage.database.set(key, Array.from(newSet));
    }

    async isToolAllowed(toolName: string, sessionId?: string): Promise<boolean> {
        const sessionArr = await this.storage.database.get<string[]>(this.buildKey(sessionId));
        if (Array.isArray(sessionArr) && sessionArr.includes(toolName)) return true;

        // Fallback to global approvals
        const globalArr = await this.storage.database.get<string[]>(this.buildKey(undefined));
        const allowed = Array.isArray(globalArr) ? globalArr.includes(toolName) : false;
        logger.debug(
            `Checked allowed tool '${toolName}' in session '${sessionId ?? 'global'}' – allowed=${allowed}`
        );
        return allowed;
    }

    async getAllowedTools(sessionId?: string): Promise<Set<string>> {
        const arr = await this.storage.database.get<string[]>(this.buildKey(sessionId));
        return new Set<string>(Array.isArray(arr) ? arr : []);
    }
}
