import { promises as fs } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getDextoGlobalPath } from '../../utils/path.js';
import { logger as defaultLogger } from '../../logger/logger.js';
import type { Logger } from '../../logger/v2/types.js';
import type { LLMProvider } from '../types.js';
import { LLM_PROVIDERS } from '../types.js';
import { LLM_REGISTRY } from './index.js';
import type { ModelInfo } from './index.js';
import { buildModelsByProviderFromRemote } from './sync.js';

type LogLike = Pick<Logger, 'debug' | 'info' | 'warn' | 'error'>;

const CACHE_SUBDIR = 'cache';
const CACHE_FILENAME = 'llm-registry-models.json';
const CACHE_SCHEMA_VERSION = 1;

const DEFAULT_TTL_MS = 1000 * 60 * 60; // 1 hour
const MIN_REFRESH_INTERVAL_MS = 1000 * 60 * 5; // 5 minutes

const UPDATABLE_PROVIDERS: LLMProvider[] = [
    'openai',
    'anthropic',
    'google',
    'groq',
    'xai',
    'cohere',
    'minimax',
    'zhipuai',
    'moonshotai',
    'google-vertex',
    'google-vertex-anthropic',
    'amazon-bedrock',
];

type CacheFile = {
    schemaVersion: number;
    fetchedAt: string;
    modelsByProvider: Record<string, unknown>;
};

function truthyEnv(name: string): boolean {
    const v = process.env[name];
    if (!v) return false;
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function getTtlMs(): number {
    const raw = process.env.DEXTO_LLM_REGISTRY_TTL_MS;
    if (!raw) return DEFAULT_TTL_MS;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

function getCachePath(): string {
    return getDextoGlobalPath(CACHE_SUBDIR, CACHE_FILENAME);
}

function isModelInfo(value: unknown): value is ModelInfo {
    if (typeof value !== 'object' || value === null) return false;
    const name = (value as { name?: unknown }).name;
    return typeof name === 'string' && name.trim() !== '';
}

function applyModelsByProvider(modelsByProvider: Record<LLMProvider, ModelInfo[]>): void {
    for (const provider of UPDATABLE_PROVIDERS) {
        const incoming = modelsByProvider[provider] ?? [];
        const existing = LLM_REGISTRY[provider].models ?? [];

        const incomingByName = new Map<string, ModelInfo>();
        for (const m of incoming) {
            incomingByName.set(m.name.toLowerCase(), m);
        }

        const existingDefault = existing.find((m) => m.default)?.name.toLowerCase();
        const incomingDefault = incoming.find((m) => m.default)?.name.toLowerCase();

        const merged: ModelInfo[] = [];
        const seen = new Set<string>();

        // Keep existing order for stability, but replace entries when the remote provides updates.
        for (const m of existing) {
            const key = m.name.toLowerCase();
            const updated = incomingByName.get(key);
            if (!updated) {
                merged.push(m);
            } else {
                // Be conservative when applying remote updates:
                // - Prefer remote for core metadata (tokens/pricing/capabilities)
                // - Preserve existing fields when the remote is missing them.
                const name = updated.name ?? m.name;
                const maxInputTokens =
                    typeof updated.maxInputTokens === 'number' && updated.maxInputTokens > 0
                        ? updated.maxInputTokens
                        : m.maxInputTokens;
                const supportedFileTypes = Array.isArray(updated.supportedFileTypes)
                    ? updated.supportedFileTypes
                    : m.supportedFileTypes;

                const displayName = updated.displayName ?? m.displayName;
                const pricing = updated.pricing ?? m.pricing;

                merged.push({
                    name,
                    maxInputTokens,
                    supportedFileTypes,
                    ...(displayName ? { displayName } : {}),
                    ...(pricing ? { pricing } : {}),
                });
            }
            seen.add(key);
        }

        // Append brand-new models (sorted for stable diffs).
        const newModels = incoming.filter((m) => !seen.has(m.name.toLowerCase()));
        newModels.sort((a, b) => a.name.localeCompare(b.name));
        merged.push(...newModels);

        // Ensure there's a default model. Prefer the remote default when present,
        // otherwise preserve the existing default, otherwise fall back to the first entry.
        const chosenDefault = incomingDefault ?? existingDefault ?? merged[0]?.name.toLowerCase();
        const finalMerged = merged.map((m) => {
            const copy = { ...m } as ModelInfo;
            delete (copy as { default?: boolean }).default;
            return copy;
        });
        if (chosenDefault) {
            const idx = finalMerged.findIndex((m) => m.name.toLowerCase() === chosenDefault);
            if (idx >= 0) {
                finalMerged[idx] = { ...finalMerged[idx]!, default: true };
            }
        }

        LLM_REGISTRY[provider].models = finalMerged;
    }
}

function normalizeModelsByProvider(raw: Record<string, unknown>): Record<LLMProvider, ModelInfo[]> {
    const out = {} as Record<LLMProvider, ModelInfo[]>;
    for (const p of LLM_PROVIDERS) {
        const value = raw[p];
        out[p] = Array.isArray(value) ? (value.filter(isModelInfo) as ModelInfo[]) : [];
    }
    return out;
}

function tryLoadCacheFromDisk(
    log?: LogLike
): { fetchedAt: number; modelsByProvider: Record<LLMProvider, ModelInfo[]> } | null {
    const cachePath = getCachePath();
    if (!existsSync(cachePath)) return null;

    try {
        const text = readFileSync(cachePath, 'utf-8');
        const parsed = JSON.parse(text) as CacheFile;
        if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
        if (!parsed.fetchedAt || typeof parsed.fetchedAt !== 'string') return null;
        if (!parsed.modelsByProvider || typeof parsed.modelsByProvider !== 'object') return null;

        const fetchedAt = Date.parse(parsed.fetchedAt);
        if (!Number.isFinite(fetchedAt)) return null;

        const modelsByProvider = normalizeModelsByProvider(
            parsed.modelsByProvider as Record<string, unknown>
        );
        return { fetchedAt, modelsByProvider };
    } catch (e) {
        log?.warn?.(
            `Failed to load LLM registry cache (${cachePath}): ${e instanceof Error ? e.message : String(e)}`
        );
        return null;
    }
}

let refreshPromise: Promise<void> | null = null;
let lastRefreshAttemptAt: number | null = null;
let lastFetchedAt: number | null = null;
let lastSource: 'snapshot' | 'cache' | 'remote' = 'snapshot';
let autoRefreshStarted = false;

export type LlmRegistryAutoUpdateStatus = {
    cachePath: string;
    lastFetchedAt: Date | null;
    isFresh: boolean;
    source: 'snapshot' | 'cache' | 'remote';
};

function isFresh(now: number, fetchedAt: number, ttlMs: number): boolean {
    return now - fetchedAt < ttlMs;
}

export function getLlmRegistryAutoUpdateStatus(): LlmRegistryAutoUpdateStatus {
    const cachePath = getCachePath();
    const fetchedAt = lastFetchedAt ? new Date(lastFetchedAt) : null;
    const now = Date.now();
    return {
        cachePath,
        lastFetchedAt: fetchedAt,
        isFresh: lastFetchedAt ? isFresh(now, lastFetchedAt, getTtlMs()) : false,
        source: lastSource,
    };
}

export function loadLlmRegistryCache(options?: { logger?: LogLike }): boolean {
    const cache = tryLoadCacheFromDisk(options?.logger);
    if (!cache) return false;
    applyModelsByProvider(cache.modelsByProvider);
    lastFetchedAt = cache.fetchedAt;
    lastSource = 'cache';
    return true;
}

async function writeCacheFile(
    cachePath: string,
    modelsByProvider: Record<LLMProvider, ModelInfo[]>
): Promise<void> {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    const payload: CacheFile = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        fetchedAt: new Date().toISOString(),
        modelsByProvider: modelsByProvider as unknown as Record<string, unknown>,
    };
    const tmpPath = `${cachePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(payload), 'utf-8');
    await fs.rename(tmpPath, cachePath);
}

export async function refreshLlmRegistryCache(options?: {
    logger?: LogLike;
    force?: boolean;
    /**
     * Test-only escape hatch to validate refresh behavior with mocks while keeping
     * network fetch disabled by default in CI/unit tests.
     */
    allowInTests?: boolean;
}): Promise<void> {
    if (
        truthyEnv('DEXTO_LLM_REGISTRY_DISABLE_FETCH') ||
        (!options?.allowInTests && (process.env.NODE_ENV === 'test' || truthyEnv('VITEST')))
    ) {
        return;
    }

    if (refreshPromise && !options?.force) {
        await refreshPromise;
        return;
    }

    const now = Date.now();
    if (
        !options?.force &&
        lastRefreshAttemptAt &&
        now - lastRefreshAttemptAt < MIN_REFRESH_INTERVAL_MS
    ) {
        if (refreshPromise) await refreshPromise;
        return;
    }

    lastRefreshAttemptAt = now;
    const log = options?.logger ?? (defaultLogger as unknown as LogLike);

    refreshPromise = (async () => {
        const modelsByProvider = await buildModelsByProviderFromRemote({
            userAgent: 'dexto-llm-registry',
            timeoutMs: 30_000,
        });

        const cachePath = getCachePath();
        await writeCacheFile(cachePath, modelsByProvider);
        applyModelsByProvider(modelsByProvider);
        lastFetchedAt = Date.now();
        lastSource = 'remote';
        log?.debug?.(`Refreshed LLM registry cache (${cachePath})`);
    })()
        .catch((e) => {
            log?.warn?.(
                `Failed to refresh LLM registry cache: ${e instanceof Error ? e.message : String(e)}`
            );
        })
        .finally(() => {
            refreshPromise = null;
        });

    await refreshPromise;
}

export function startLlmRegistryAutoUpdate(options?: {
    logger?: LogLike;
    refreshOnStart?: boolean;
}): void {
    if (autoRefreshStarted) return;
    autoRefreshStarted = true;

    const log = options?.logger ?? (defaultLogger as unknown as LogLike);

    // Apply cached models immediately (fast, offline)
    const loaded = loadLlmRegistryCache({ logger: log });
    if (loaded) {
        log?.debug?.(`Loaded LLM registry cache from disk (${getCachePath()})`);
    }

    // Optionally refresh in the background
    if (options?.refreshOnStart !== false) {
        void refreshLlmRegistryCache({ logger: log });
    }

    // Periodic refresh (unref so it won't keep the process alive)
    const timer = setInterval(
        () => {
            const ttlMs = getTtlMs();
            const now = Date.now();
            if (lastFetchedAt && isFresh(now, lastFetchedAt, ttlMs)) return;
            void refreshLlmRegistryCache({ logger: log });
        },
        Math.min(getTtlMs(), DEFAULT_TTL_MS)
    );

    timer.unref?.();
}
