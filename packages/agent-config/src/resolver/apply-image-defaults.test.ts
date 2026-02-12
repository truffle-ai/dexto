import { describe, it, expect } from 'vitest';
import type { AgentConfig } from '../schemas/agent-config.js';
import type { ImageDefaults } from '../image/types.js';
import { applyImageDefaults } from './apply-image-defaults.js';

describe('applyImageDefaults', () => {
    const baseConfig: AgentConfig = {
        systemPrompt: 'You are a helpful assistant',
        llm: {
            provider: 'openai',
            model: 'gpt-4o-mini',
            apiKey: 'test-key',
        },
    };

    it('returns the original config when defaults are missing', () => {
        const result = applyImageDefaults(baseConfig);
        expect(result).toBe(baseConfig);
    });

    it('prefers config values for scalar fields', () => {
        const defaults: ImageDefaults = {
            agentId: 'default-agent',
        };
        const config: AgentConfig = {
            ...baseConfig,
            agentId: 'my-agent',
        };

        expect(applyImageDefaults(config, defaults).agentId).toBe('my-agent');
    });

    it('merges object fields one level deep', () => {
        const fileDefaults: ImageDefaults = {
            agentFile: { discoverInCwd: false },
        };
        const fileConfig: AgentConfig = {
            ...baseConfig,
            agentFile: {},
        };

        expect(applyImageDefaults(fileConfig, fileDefaults).agentFile).toEqual({
            discoverInCwd: false,
        });

        const defaults: ImageDefaults = {
            storage: {
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: { type: 'local', storePath: '/tmp/default-blobs' },
            },
        };
        const config: AgentConfig = {
            ...baseConfig,
            storage: {
                cache: { type: 'redis', url: 'redis://localhost:6379' },
                database: { type: 'in-memory' },
                blob: { type: 'local', storePath: '/tmp/default-blobs' },
            },
        };

        const merged = applyImageDefaults(config, defaults);
        expect(merged.storage?.cache.type).toBe('redis');
        expect(merged.storage?.database.type).toBe('in-memory');
        expect(merged.storage?.blob.type).toBe('local');
    });

    it('treats sub-objects as atomic units (no deep merge)', () => {
        const defaults: ImageDefaults = {
            storage: {
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: { type: 'local', storePath: '/tmp/default-blobs' },
            },
        };
        const config: AgentConfig = {
            ...baseConfig,
            storage: {
                cache: { type: 'in-memory' },
                database: { type: 'in-memory' },
                blob: { type: 'in-memory' },
            },
        };

        const merged = applyImageDefaults(config, defaults);
        expect(merged.storage?.blob).toEqual({ type: 'in-memory' });
    });

    it('treats arrays as atomic units (no concatenation)', () => {
        const defaults: ImageDefaults = {
            tools: [{ type: 'builtin-tools' }, { type: 'filesystem-tools' }],
        };

        expect(applyImageDefaults(baseConfig, defaults).tools).toEqual(defaults.tools);

        const config: AgentConfig = {
            ...baseConfig,
            tools: [],
        };
        expect(applyImageDefaults(config, defaults).tools).toEqual([]);
    });

    it('retains image prompts when config provides prompts (unless explicitly cleared)', () => {
        const defaults: ImageDefaults = {
            prompts: [
                { type: 'inline', id: 'default-skill', prompt: 'default prompt' },
                { type: 'inline', id: 'shared', prompt: 'default shared prompt' },
            ],
        };

        expect(applyImageDefaults(baseConfig, defaults).prompts).toEqual(defaults.prompts);

        const configWithPrompts: AgentConfig = {
            ...baseConfig,
            prompts: [
                { type: 'inline', id: 'custom-skill', prompt: 'custom prompt' },
                { type: 'inline', id: 'shared', prompt: 'config shared prompt (override)' },
            ],
        };

        expect(applyImageDefaults(configWithPrompts, defaults).prompts).toEqual([
            { type: 'inline', id: 'default-skill', prompt: 'default prompt' },
            { type: 'inline', id: 'shared', prompt: 'config shared prompt (override)' },
            { type: 'inline', id: 'custom-skill', prompt: 'custom prompt' },
        ]);

        const configClearsPrompts: AgentConfig = {
            ...baseConfig,
            prompts: [],
        };
        expect(applyImageDefaults(configClearsPrompts, defaults).prompts).toEqual([]);
    });
});
