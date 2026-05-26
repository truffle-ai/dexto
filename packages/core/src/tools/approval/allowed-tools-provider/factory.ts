import { InMemoryAllowedToolsProvider } from './in-memory.js';
import { StorageAllowedToolsProvider } from './storage.js';
import type { AllowedToolsProvider } from './types.js';
import type { ToolPreferenceStore } from '../../../storage/index.js';
import { ToolError } from '../../errors.js';
import type { Logger } from '../../../logger/v2/types.js';

// TODO: Re-evaluate storage + permissions config together to avoid duplication
// Currently we have:
// - InMemoryAllowedToolsProvider with its own Map<string, boolean>
// - StorageAllowedToolsProvider using the typed ToolPreferenceStore
// - But an image may still back that store with in-memory storage
// This creates potential duplication when both provider and store are in-memory.
// Consider: Always use StorageAllowedToolsProvider and let store implementation handle memory vs persistence.

export type AllowedToolsConfig =
    | {
          type: 'memory';
      }
    | {
          type: 'storage';
          toolPreferenceStore: ToolPreferenceStore;
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
            return new StorageAllowedToolsProvider(config.toolPreferenceStore, logger);
        default: {
            // Exhaustive check; at runtime this guards malformed config
            const _exhaustive: never = config;
            throw ToolError.configInvalid(
                `Unsupported AllowedToolsConfig type: ${(config as any)?.type}`
            );
        }
    }
}
