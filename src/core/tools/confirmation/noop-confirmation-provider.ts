/**
 * NoOpConfirmationProvider
 *
 * A ToolConfirmationProvider implementation that always approves or denies tool execution.
 * Used as a fallback for environments where confirmation is not implemented or for
 * security scenarios where tools should be automatically denied.
 *
 * Uses InMemoryAllowedToolsProvider to satisfy the interface, but does not enforce any restrictions
 * when in auto-approve mode.
 */
import { ToolConfirmationProvider, ToolExecutionDetails } from './types.js';
import type { IAllowedToolsProvider } from './allowed-tools-provider/types.js';
import { InMemoryAllowedToolsProvider } from './allowed-tools-provider/in-memory.js';
import { logger } from '@core/logger/logger.js';

export class NoOpConfirmationProvider implements ToolConfirmationProvider {
    public allowedToolsProvider: IAllowedToolsProvider;
    private autoApprove: boolean;

    constructor(allowedToolsProvider?: IAllowedToolsProvider, autoApprove: boolean = true) {
        this.allowedToolsProvider = allowedToolsProvider ?? new InMemoryAllowedToolsProvider();
        this.autoApprove = autoApprove;
    }

    async requestConfirmation(details: ToolExecutionDetails): Promise<boolean> {
        if (this.autoApprove) {
            logger.info(
                `Tool confirmation auto-approved for ${details.toolName}, sessionId: ${details.sessionId ?? 'global'} (auto-approve mode)`
            );
        } else {
            logger.info(
                `Tool confirmation auto-denied for ${details.toolName}, sessionId: ${details.sessionId ?? 'global'} (auto-deny mode)`
            );
        }
        return this.autoApprove; // Always approve or deny based on configuration
    }
}
