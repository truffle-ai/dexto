import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelInfo } from './index.js';
import type { LLMProvider } from '../types.js';

const TEST_ROOT = mkdtempSync(path.join(os.tmpdir(), 'dexto-llm-registry-auto-update-'));

vi.mock('../../utils/path.js', () => ({
    getDextoGlobalPath: (...parts: string[]) => path.join(TEST_ROOT, ...parts),
}));

vi.mock('./sync.js', () => ({
    buildModelsByProviderFromRemote: vi.fn(),
}));

afterAll(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
});

const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
};

const UPDATABLE_PROVIDERS: LLMProvider[] = [
    'openai',
    'anthropic',
    'google',
    'groq',
    'xai',
    'cohere',
    'minimax',
    'glm',
    'vertex',
    'bedrock',
];

async function writeCacheFile(cachePath: string, payload: unknown): Promise<void> {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(payload), 'utf-8');
}

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    await fs.mkdir(TEST_ROOT, { recursive: true });
});

describe('llm registry auto-update', () => {
    it('loadLlmRegistryCache returns false when cache file is missing', async () => {
        const autoUpdate = await import('./auto-update.js');

        expect(autoUpdate.loadLlmRegistryCache({ logger: mockLogger })).toBe(false);
    });

    it('loadLlmRegistryCache ignores cache files with wrong schemaVersion', async () => {
        const autoUpdate = await import('./auto-update.js');
        const { cachePath } = autoUpdate.getLlmRegistryAutoUpdateStatus();

        await writeCacheFile(cachePath, {
            schemaVersion: 999,
            fetchedAt: new Date().toISOString(),
            modelsByProvider: {},
        });

        expect(autoUpdate.loadLlmRegistryCache({ logger: mockLogger })).toBe(false);
    });

    it('loadLlmRegistryCache ignores malformed model entries (missing name) instead of throwing', async () => {
        const registry = await import('./index.js');
        const autoUpdate = await import('./auto-update.js');
        const { cachePath } = autoUpdate.getLlmRegistryAutoUpdateStatus();

        registry.LLM_REGISTRY.openai.models = [
            {
                name: 'gpt-5',
                maxInputTokens: 1000,
                supportedFileTypes: [],
                default: true,
            },
        ] satisfies ModelInfo[];

        await writeCacheFile(cachePath, {
            schemaVersion: 1,
            fetchedAt: new Date().toISOString(),
            modelsByProvider: {
                openai: [
                    // Missing name would previously throw via m.name.toLowerCase() during merge.
                    { maxInputTokens: 123, supportedFileTypes: [] },
                ],
            },
        });

        expect(autoUpdate.loadLlmRegistryCache({ logger: mockLogger })).toBe(true);

        expect(registry.LLM_REGISTRY.openai.models.map((m) => m.name)).toEqual(['gpt-5']);
    });

    it('loadLlmRegistryCache applies cached models and preserves stable merge behavior', async () => {
        const registry = await import('./index.js');
        const autoUpdate = await import('./auto-update.js');
        const { cachePath } = autoUpdate.getLlmRegistryAutoUpdateStatus();

        registry.LLM_REGISTRY.openai.models = [
            {
                name: 'gpt-5',
                displayName: 'GPT-5',
                maxInputTokens: 1000,
                supportedFileTypes: [],
                default: true,
                pricing: { inputPerM: 1, outputPerM: 2 },
                reasoning: true,
                supportsTemperature: false,
                supportsInterleaved: true,
            },
            {
                name: 'gpt-5-mini',
                displayName: 'GPT-5 Mini',
                maxInputTokens: 800,
                supportedFileTypes: [],
            },
        ] satisfies ModelInfo[];

        await writeCacheFile(cachePath, {
            schemaVersion: 1,
            fetchedAt: new Date().toISOString(),
            modelsByProvider: {
                openai: [
                    // Update existing model metadata; omit optional fields to ensure fallback preserves existing.
                    { name: 'gpt-5', maxInputTokens: 2000, supportedFileTypes: ['image'] },
                    // Invalid remote token count should not overwrite existing.
                    {
                        name: 'gpt-5-mini',
                        maxInputTokens: 0,
                        supportedFileTypes: [],
                        default: true,
                    },
                    // New models should be appended, sorted.
                    { name: 'zzz-new-model', maxInputTokens: 456, supportedFileTypes: [] },
                    { name: 'aaa-new-model', maxInputTokens: 123, supportedFileTypes: [] },
                ],
            },
        });

        expect(autoUpdate.loadLlmRegistryCache({ logger: mockLogger })).toBe(true);

        const models = registry.LLM_REGISTRY.openai.models;
        expect(models.map((m) => m.name)).toEqual([
            'gpt-5',
            'gpt-5-mini',
            'aaa-new-model',
            'zzz-new-model',
        ]);

        const gpt5 = models[0]!;
        expect(gpt5.maxInputTokens).toBe(2000);
        expect(gpt5.displayName).toBe('GPT-5');
        expect(gpt5.pricing).toEqual({ inputPerM: 1, outputPerM: 2 });
        expect(gpt5.supportedFileTypes).toEqual(['image']);
        expect(gpt5.reasoning).toBe(true);
        expect(gpt5.supportsTemperature).toBe(false);
        expect(gpt5.supportsInterleaved).toBe(true);

        const gpt5Mini = models[1]!;
        expect(gpt5Mini.maxInputTokens).toBe(800); // preserved (remote provided 0)
        expect(gpt5Mini.default).toBe(true); // remote default wins
        expect(models.filter((m) => m.default).map((m) => m.name)).toEqual(['gpt-5-mini']);

        const status = autoUpdate.getLlmRegistryAutoUpdateStatus();
        expect(status.source).toBe('cache');
        expect(status.lastFetchedAt).toBeInstanceOf(Date);
    });

    it('loadLlmRegistryCache preserves and updates reasoning capability fields', async () => {
        const registry = await import('./index.js');
        const autoUpdate = await import('./auto-update.js');
        const { cachePath } = autoUpdate.getLlmRegistryAutoUpdateStatus();

        registry.LLM_REGISTRY.anthropic.models = [
            {
                name: 'claude-3-7-sonnet-20250219',
                displayName: 'Claude Sonnet 3.7',
                maxInputTokens: 200000,
                supportedFileTypes: ['pdf', 'image'],
                reasoning: true,
                supportsTemperature: true,
                supportsInterleaved: false,
                default: true,
            },
        ] satisfies ModelInfo[];

        await writeCacheFile(cachePath, {
            schemaVersion: 1,
            fetchedAt: new Date().toISOString(),
            modelsByProvider: {
                anthropic: [
                    // Explicitly flip capability flags to ensure we apply incoming booleans.
                    {
                        name: 'claude-3-7-sonnet-20250219',
                        maxInputTokens: 200000,
                        supportedFileTypes: ['pdf', 'image'],
                        reasoning: false,
                        supportsTemperature: false,
                        supportsInterleaved: true,
                    },
                ],
            },
        });

        expect(autoUpdate.loadLlmRegistryCache({ logger: mockLogger })).toBe(true);

        const model = registry.LLM_REGISTRY.anthropic.models[0]!;
        expect(model.name).toBe('claude-3-7-sonnet-20250219');
        expect(model.reasoning).toBe(false);
        expect(model.supportsTemperature).toBe(false);
        expect(model.supportsInterleaved).toBe(true);
    });

    it('refreshLlmRegistryCache updates the registry from remote (mocked) and writes cache', async () => {
        const registry = await import('./index.js');
        const autoUpdate = await import('./auto-update.js');
        const sync = await import('./sync.js');

        const { cachePath } = autoUpdate.getLlmRegistryAutoUpdateStatus();
        registry.LLM_REGISTRY.openai.models = [
            {
                name: 'gpt-5',
                maxInputTokens: 1000,
                supportedFileTypes: [],
                default: true,
            },
        ];

        // Keep other providers small so applyModelsByProvider stays fast and deterministic.
        for (const provider of UPDATABLE_PROVIDERS) {
            if (provider === 'openai') continue;
            registry.LLM_REGISTRY[provider].models = [];
        }

        const build = sync.buildModelsByProviderFromRemote as unknown as ReturnType<typeof vi.fn>;
        build.mockResolvedValue({
            openai: [
                {
                    name: 'gpt-5',
                    maxInputTokens: 1500,
                    supportedFileTypes: [],
                    default: true,
                },
                {
                    name: 'gpt-5-mini',
                    maxInputTokens: 800,
                    supportedFileTypes: [],
                },
            ],
        });

        await autoUpdate.refreshLlmRegistryCache({
            logger: mockLogger,
            force: true,
            allowInTests: true,
        });

        expect(build).toHaveBeenCalledWith(
            expect.objectContaining({
                userAgent: 'dexto-llm-registry',
                timeoutMs: 30_000,
            })
        );

        // Cache file written
        await expect(fs.stat(cachePath)).resolves.toBeDefined();

        // Registry updated
        expect(registry.LLM_REGISTRY.openai.models.map((m) => m.name)).toEqual([
            'gpt-5',
            'gpt-5-mini',
        ]);
        expect(registry.LLM_REGISTRY.openai.models[0]!.maxInputTokens).toBe(1500);

        const status = autoUpdate.getLlmRegistryAutoUpdateStatus();
        expect(status.source).toBe('remote');
        expect(status.lastFetchedAt).toBeInstanceOf(Date);
    });
});
