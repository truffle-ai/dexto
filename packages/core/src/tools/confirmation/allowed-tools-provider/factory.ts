import { InMemoryAllowedToolsProvider } from './in-memory.js';
import { StorageAllowedToolsProvider } from './storage.js';
import type { AllowedToolsProvider } from './types.js';
import type { StorageManager } from '../../../storage/index.js';
import { ToolError } from '../../errors.js';
import type { Logger } from '../../../logger/v2/types.js';

// TODO: Re-evaluate storage + toolConfirmation config together to avoid duplication
// Currently we have:
// - InMemoryAllowedToolsProvider with its own Map<string, boolean>
// - StorageAllowedToolsProvider using config.storage.database
// - But config.storage.database might ALSO be in-memory (separate storage!)
// This creates potential duplication when storage backend is in-memory.
// Consider: Always use StorageAllowedToolsProvider and let storage backend handle memory vs persistence.

export type AllowedToolsConfig =
    | {
          type: 'memory';
      }
    | {
          type: 'storage';
          storageManager: StorageManager;
      };

/**
 * Create an AllowedToolsProvider based on configuration.
 */
export function createAllowedToolsProvider(
    config: AllowedToolsConfig,
    logger: Logger
): AllowedToolsProvider {
    switch (config.type) {
        case 'memory':
            return new InMemoryAllowedToolsProvider();
        case 'storage':
            return new StorageAllowedToolsProvider(config.storageManager, logger);
        default: {
            // Exhaustive check; at runtime this guards malformed config
            const _exhaustive: never = config;
            throw ToolError.configInvalid(
                `Unsupported AllowedToolsConfig type: ${(config as any)?.type}`
            );
        }
    }
}
