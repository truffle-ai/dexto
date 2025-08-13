/**
 * ToolConfirmationProvider Factory
 *
 * Creates ToolConfirmationProvider instances with all required configuration.
 * All fields are mandatory - no defaults or fallbacks.
 *
 * Usage:
 *   import { createToolConfirmationProvider } from './factory.js';
 *   const provider = createToolConfirmationProvider({
 *     mode: 'event-based',
 *     allowedToolsProvider,
 *     confirmationTimeout: 30000,
 *     agentEventBus
 *   });
 */

import { ToolConfirmationProvider } from './types.js';
import { EventBasedConfirmationProvider } from './event-based-confirmation-provider.js';
import { NoOpConfirmationProvider } from './noop-confirmation-provider.js';
import type { IAllowedToolsProvider } from './allowed-tools-provider/types.js';
import { AgentEventBus } from '../../events/index.js';

export type ToolConfirmationMode = 'event-based' | 'auto-approve' | 'auto-deny';

export interface ToolConfirmationOptions {
    mode: ToolConfirmationMode;
    allowedToolsProvider: IAllowedToolsProvider;
    confirmationTimeout: number;
    agentEventBus: AgentEventBus;
}

export function createToolConfirmationProvider(
    options: ToolConfirmationOptions
): ToolConfirmationProvider {
    const { mode, allowedToolsProvider, confirmationTimeout, agentEventBus } = options;

    switch (mode) {
        case 'event-based':
            return new EventBasedConfirmationProvider(allowedToolsProvider, agentEventBus, {
                confirmationTimeout,
            });
        case 'auto-approve':
            return new NoOpConfirmationProvider(allowedToolsProvider);
        case 'auto-deny':
            return new NoOpConfirmationProvider(allowedToolsProvider, false);
    }
}
