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
 *     confirmationTimeout: 120000,
 *     agentEventBus
 *   });
 */

import { ToolConfirmationProvider } from './types.js';
import { EventBasedConfirmationProvider } from './event-based-confirmation-provider.js';
import { NoOpConfirmationProvider } from './noop-confirmation-provider.js';
import type { IAllowedToolsProvider } from './allowed-tools-provider/types.js';
import { AgentEventBus } from '../../events/index.js';
import { ToolError } from '../errors.js';

export type ToolConfirmationMode = 'event-based' | 'auto-approve' | 'auto-deny';

export type ToolConfirmationOptions =
    | {
          mode: 'event-based';
          allowedToolsProvider: IAllowedToolsProvider;
          confirmationTimeout: number;
          agentEventBus: AgentEventBus;
      }
    | {
          mode: 'auto-approve' | 'auto-deny';
          allowedToolsProvider: IAllowedToolsProvider;
      };

export function createToolConfirmationProvider(
    options: ToolConfirmationOptions
): ToolConfirmationProvider {
    switch (options.mode) {
        case 'event-based':
            return new EventBasedConfirmationProvider(
                options.allowedToolsProvider,
                options.agentEventBus,
                {
                    confirmationTimeout: options.confirmationTimeout,
                }
            );
        case 'auto-approve':
            return new NoOpConfirmationProvider(options.allowedToolsProvider);
        case 'auto-deny':
            return new NoOpConfirmationProvider(options.allowedToolsProvider, false);
        default: {
            // Exhaustive check; at runtime this guards malformed config
            const _exhaustive: never = options;
            throw ToolError.configInvalid(
                `Unsupported ToolConfirmationMode: ${(options as any)?.mode}`
            );
        }
    }
}
