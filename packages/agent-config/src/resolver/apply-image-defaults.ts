import type { AgentConfig } from '../schemas/agent-config.js';
import type { ImageDefaults } from '../image/types.js';
import type { PlainObject } from './utils.js';
import { isPlainObject } from './utils.js';

/**
 * Apply image defaults to an *unvalidated* agent config.
 *
 * Merge strategy (see plan Section 12):
 * - shallow top-level merge, config wins
 * - object fields merge 1-level deep
 * - arrays are atomic and fully replaced (no concatenation)
 */
export function applyImageDefaults(config: AgentConfig, defaults?: ImageDefaults): AgentConfig {
    if (!defaults) {
        return config;
    }

    const merged: PlainObject = { ...defaults, ...config };

    for (const [key, defaultValue] of Object.entries(defaults)) {
        const configValue = (config as PlainObject)[key];
        if (!isPlainObject(defaultValue) || !isPlainObject(configValue)) {
            continue;
        }

        merged[key] = {
            ...defaultValue,
            ...configValue,
        };
    }

    return merged as AgentConfig;
}
