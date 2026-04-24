import type { ToolPreferenceStore } from '../../../storage/index.js';
import type { AllowedToolsProvider } from './types.js';
import type { Logger } from '../../../logger/v2/types.js';

/**
 * Storage-backed implementation that persists allowed tools in the typed tool-preference store.
 */
export class StorageAllowedToolsProvider implements AllowedToolsProvider {
    private logger: Logger;

    constructor(
        private toolPreferenceStore: ToolPreferenceStore,
        logger: Logger
    ) {
        this.logger = logger;
    }

    async allowTool(toolName: string, sessionId?: string): Promise<void> {
        await this.toolPreferenceStore.allowTool({
            toolName,
            ...(sessionId !== undefined && { sessionId }),
        });
        this.logger.debug(
            `Added allowed tool '${toolName}' for session '${sessionId ?? 'global'}'`
        );
    }

    async disallowTool(toolName: string, sessionId?: string): Promise<void> {
        await this.toolPreferenceStore.disallowTool({
            toolName,
            ...(sessionId !== undefined && { sessionId }),
        });
    }

    async isToolAllowed(toolName: string, sessionId?: string): Promise<boolean> {
        const allowed = await this.toolPreferenceStore.isToolAllowed({
            toolName,
            ...(sessionId !== undefined && { sessionId }),
        });
        this.logger.debug(
            `Checked allowed tool '${toolName}' in session '${sessionId ?? 'global'}' - allowed=${allowed}`
        );
        return allowed;
    }

    async getAllowedTools(sessionId?: string): Promise<Set<string>> {
        return new Set(
            await this.toolPreferenceStore.listAllowedTools({
                ...(sessionId !== undefined && { sessionId }),
            })
        );
    }
}
