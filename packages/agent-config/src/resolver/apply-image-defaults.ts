import type { AgentConfig } from '../schemas/agent-config.js';
import type { ImageDefaults } from '../image/types.js';
import type { PlainObject } from './utils.js';
import { isPlainObject } from './utils.js';

function promptIdentityKey(prompt: unknown): string | null {
    if (!isPlainObject(prompt)) {
        return null;
    }

    const type = prompt.type;
    if (type === 'inline') {
        const id = prompt.id;
        return typeof id === 'string' && id.length > 0 ? `inline:${id}` : null;
    }

    if (type === 'file') {
        const file = prompt.file;
        if (typeof file !== 'string' || file.length === 0) {
            return null;
        }
        const namespace = prompt.namespace;
        const namespacePart = typeof namespace === 'string' ? namespace : '';
        return `file:${namespacePart}:${file}`;
    }

    return null;
}

function mergePrompts(configPrompts: unknown, defaultPrompts: unknown): unknown {
    if (configPrompts === undefined) {
        return defaultPrompts;
    }

    if (!Array.isArray(configPrompts)) {
        return configPrompts;
    }

    if (configPrompts.length === 0) {
        // Explicit override: allow config to intentionally clear image prompts.
        return [];
    }

    if (!Array.isArray(defaultPrompts) || defaultPrompts.length === 0) {
        return configPrompts;
    }

    const order: string[] = [];
    const entries = new Map<string, unknown>();

    for (const [idx, prompt] of defaultPrompts.entries()) {
        const key = promptIdentityKey(prompt) ?? `default:${idx}`;
        if (!entries.has(key)) {
            order.push(key);
        }
        entries.set(key, prompt);
    }

    for (const [idx, prompt] of configPrompts.entries()) {
        const key = promptIdentityKey(prompt) ?? `config:${idx}`;
        if (!entries.has(key)) {
            order.push(key);
        }
        entries.set(key, prompt);
    }

    return order.map((key) => entries.get(key)!);
}

/**
 * Apply image defaults to an *unvalidated* agent config.
 *
 * Merge strategy:
 * - shallow top-level merge, config wins
 * - object fields merge 1-level deep
 * - arrays are atomic and fully replaced (no concatenation) EXCEPT:
 *   - prompts: when config provides prompts, image prompts are retained unless config sets prompts: []
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

    if ('prompts' in defaults || 'prompts' in (config as PlainObject)) {
        merged.prompts = mergePrompts(
            (config as PlainObject).prompts,
            (defaults as PlainObject).prompts
        );
    }

    return merged as AgentConfig;
}
