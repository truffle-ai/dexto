/**
 * OpenRouter Model Registry
 *
 * Provides dynamic model validation against OpenRouter's catalog of 100+ models.
 * Fetches and caches the model list from OpenRouter's API with a 24-hour TTL.
 *
 * Features:
 * - Lazy loading: Cache is populated on first lookup
 * - Background refresh: Non-blocking cache updates
 * - Graceful degradation: Returns 'unknown' when cache is stale, allowing config
 * - Throttled requests: Max 1 refresh per 5 minutes to avoid rate limits
 */

import { promises as fs } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getDextoGlobalPath } from '../../utils/path.js';
import { logger } from '../../logger/logger.js';

const OPENROUTER_MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
const CACHE_FILENAME = 'openrouter-models.json';
const CACHE_SUBDIR = 'cache';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const MIN_REFRESH_INTERVAL_MS = 1000 * 60 * 5; // 5 minutes throttle between refresh attempts

export type LookupStatus = 'valid' | 'invalid' | 'unknown';

/** Model info stored in cache */
export interface OpenRouterModelInfo {
    id: string;
    contextLength: number;
    /**
     * Human-friendly model name from OpenRouter (e.g. "Claude Sonnet 4.5").
     */
    displayName?: string;
    /**
     * OpenRouter expiration date (YYYY-MM-DD) when present.
     * Models past this date should be treated as invalid/deprecated.
     */
    expirationDate?: string;
    /**
     * OpenRouter supported parameters (e.g. includes "reasoning" for reasoning-capable models).
     */
    supportedParameters?: string[];
}

interface CacheFile {
    fetchedAt: string;
    models: OpenRouterModelInfo[];
}

interface RefreshOptions {
    apiKey?: string;
    force?: boolean;
    timeoutMs?: number;
    /**
     * Test-only escape hatch for unit tests that want to validate refresh behavior.
     * Network fetch is disabled by default when NODE_ENV === 'test' or VITEST is set.
     */
    allowInTests?: boolean;
}

/** Default context length when not available from API */
const DEFAULT_CONTEXT_LENGTH = 128000;

class OpenRouterModelRegistry {
    /** Map from normalized model ID to model info */
    private models: Map<string, OpenRouterModelInfo> | null = null;
    private lastFetchedAt: number | null = null;
    private refreshPromise: Promise<void> | null = null;
    private lastRefreshAttemptAt: number | null = null;
    private lastUsedApiKey?: string;

    constructor(private readonly cachePath: string) {
        this.loadCacheFromDisk();
    }

    private parseExpirationDateEndUtc(expirationDate: string): number | null {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expirationDate.trim());
        if (!match) return null;

        const year = Number(match[1]);
        const monthIndex = Number(match[2]) - 1; // 0-based
        const day = Number(match[3]);
        if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
            return null;
        }

        return Date.UTC(year, monthIndex, day, 23, 59, 59, 999);
    }

    private isExpired(model: OpenRouterModelInfo): boolean {
        if (!model.expirationDate) return false;
        const expiresAt = this.parseExpirationDateEndUtc(model.expirationDate);
        if (!expiresAt) return false;
        return Date.now() > expiresAt;
    }

    /**
     * Look up a model ID against the OpenRouter catalog.
     * @returns 'valid' if model exists, 'invalid' if not found, 'unknown' if cache is stale/empty
     */
    lookup(modelId: string): LookupStatus {
        const normalized = this.normalizeModelId(modelId);
        if (!normalized) {
            return 'unknown';
        }

        if (!this.models || this.models.size === 0) {
            // No cache yet - kick off a background refresh and allow for now
            this.scheduleRefresh({ force: true });
            return 'unknown';
        }

        const info = this.models.get(normalized);
        if (info && this.isExpired(info)) {
            return 'invalid';
        }

        if (!this.isCacheFresh()) {
            // Don't rely on stale data - refresh in background and treat as unknown
            this.scheduleRefresh();
            return 'unknown';
        }

        return info ? 'valid' : 'invalid';
    }

    /**
     * Get context length for a model ID.
     * @returns context length if model is in cache, null if not found or cache is stale
     */
    getContextLength(modelId: string): number | null {
        const normalized = this.normalizeModelId(modelId);
        if (!normalized) {
            return null;
        }

        if (!this.models || this.models.size === 0 || !this.isCacheFresh()) {
            return null;
        }

        const info = this.models.get(normalized);
        if (info && this.isExpired(info)) return null;
        return info?.contextLength ?? null;
    }

    /**
     * Get model info for a model ID.
     * @returns model info if found in cache, null otherwise
     */
    getModelInfo(modelId: string): OpenRouterModelInfo | null {
        const normalized = this.normalizeModelId(modelId);
        if (!normalized) {
            return null;
        }

        if (!this.models || this.models.size === 0 || !this.isCacheFresh()) {
            return null;
        }

        const info = this.models.get(normalized) ?? null;
        if (info && this.isExpired(info)) return null;
        return info;
    }

    /**
     * Schedule a non-blocking background refresh of the model cache.
     */
    scheduleRefresh(options?: RefreshOptions): void {
        const apiKey = options?.apiKey ?? this.lastUsedApiKey;
        if (apiKey) {
            this.lastUsedApiKey = apiKey;
        }

        if (
            (process.env.NODE_ENV === 'test' || process.env.VITEST) &&
            options?.allowInTests !== true
        ) {
            return;
        }

        if (this.refreshPromise) {
            return; // Refresh already in-flight
        }

        const now = Date.now();
        if (
            !options?.force &&
            this.lastRefreshAttemptAt &&
            now - this.lastRefreshAttemptAt < MIN_REFRESH_INTERVAL_MS
        ) {
            return; // Throttle refresh attempts
        }

        this.lastRefreshAttemptAt = now;
        this.refreshPromise = this.refreshInternal(apiKey, options?.timeoutMs)
            .catch((error) => {
                logger.warn(
                    `Failed to refresh OpenRouter model registry: ${error instanceof Error ? error.message : String(error)}`
                );
            })
            .finally(() => {
                this.refreshPromise = null;
            });
    }

    /**
     * Blocking refresh of the model cache.
     */
    async refresh(options?: RefreshOptions): Promise<void> {
        const apiKey = options?.apiKey ?? this.lastUsedApiKey;
        if (apiKey) {
            this.lastUsedApiKey = apiKey;
        }

        if (
            (process.env.NODE_ENV === 'test' || process.env.VITEST) &&
            options?.allowInTests !== true
        ) {
            return;
        }

        if (!options?.force && this.refreshPromise) {
            await this.refreshPromise;
            return;
        }

        if (!options?.force) {
            const now = Date.now();
            if (
                this.lastRefreshAttemptAt &&
                now - this.lastRefreshAttemptAt < MIN_REFRESH_INTERVAL_MS
            ) {
                if (this.refreshPromise) {
                    await this.refreshPromise;
                }
                return;
            }
            this.lastRefreshAttemptAt = now;
        } else {
            this.lastRefreshAttemptAt = Date.now();
        }

        const promise = this.refreshInternal(apiKey, options?.timeoutMs).finally(() => {
            this.refreshPromise = null;
        });

        this.refreshPromise = promise;
        await promise;
    }

    /**
     * Get all cached model IDs (or null if cache is empty).
     */
    getCachedModels(): string[] | null {
        if (!this.models || this.models.size === 0) {
            return null;
        }
        const ids: string[] = [];
        for (const info of this.models.values()) {
            if (this.isExpired(info)) continue;
            ids.push(info.id);
        }
        return ids;
    }

    /**
     * Get all cached model info (or null if cache is empty).
     */
    getCachedModelsWithInfo(): OpenRouterModelInfo[] | null {
        if (!this.models || this.models.size === 0) {
            return null;
        }
        return Array.from(this.models.values()).filter((info) => !this.isExpired(info));
    }

    /**
     * Get cache metadata for debugging/monitoring.
     */
    getCacheMetadata(): { lastFetchedAt: Date | null; modelCount: number; isFresh: boolean } {
        return {
            lastFetchedAt: this.lastFetchedAt ? new Date(this.lastFetchedAt) : null,
            modelCount: this.models ? this.models.size : 0,
            isFresh: this.isCacheFresh(),
        };
    }

    private async refreshInternal(apiKey?: string, timeoutMs?: number): Promise<void> {
        try {
            const headers: Record<string, string> = {
                Accept: 'application/json',
            };
            if (apiKey) {
                headers.Authorization = `Bearer ${apiKey}`;
            }

            logger.debug('Refreshing OpenRouter model registry from remote source');
            const response = await fetch(OPENROUTER_MODELS_ENDPOINT, {
                headers,
                signal: AbortSignal.timeout(timeoutMs ?? 30_000),
            });
            if (!response.ok) {
                const body = await response.text();
                throw new Error(`HTTP ${response.status}: ${body}`);
            }

            const payload = await response.json();
            const models = this.extractModels(payload);
            if (models.length === 0) {
                throw new Error('No model identifiers returned by OpenRouter');
            }

            await this.writeCache(models);
            logger.info(`OpenRouter model registry refreshed with ${models.length} models`);
        } catch (error) {
            throw error instanceof Error ? error : new Error(String(error));
        }
    }

    private loadCacheFromDisk(): void {
        if (!existsSync(this.cachePath)) {
            return;
        }

        try {
            const raw = readFileSync(this.cachePath, 'utf-8');
            const parsed = JSON.parse(raw) as CacheFile;
            if (!Array.isArray(parsed.models) || typeof parsed.fetchedAt !== 'string') {
                logger.warn(`Invalid OpenRouter model cache structure at ${this.cachePath}`);
                return;
            }

            // Build map from model ID to info
            this.models = new Map();
            for (const model of parsed.models) {
                if (
                    typeof model === 'object' &&
                    typeof (model as { id?: unknown }).id === 'string' &&
                    (model as { id: string }).id.trim().length > 0 &&
                    typeof (model as { contextLength?: unknown }).contextLength === 'number'
                ) {
                    this.models.set((model as { id: string }).id.toLowerCase(), model);
                }
            }

            const timestamp = Date.parse(parsed.fetchedAt);
            this.lastFetchedAt = Number.isNaN(timestamp) ? null : timestamp;

            logger.debug(
                `Loaded ${this.models.size} OpenRouter models from cache (fetched at ${parsed.fetchedAt})`
            );
        } catch (error) {
            logger.warn(
                `Failed to load OpenRouter model cache: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    private normalizeModelId(modelId: string): string | null {
        if (!modelId) {
            return null;
        }
        return modelId.trim().toLowerCase();
    }

    private isCacheFresh(): boolean {
        if (!this.lastFetchedAt) {
            return false;
        }
        return Date.now() - this.lastFetchedAt < CACHE_TTL_MS;
    }

    private async writeCache(models: OpenRouterModelInfo[]): Promise<void> {
        // Deduplicate by ID and sort
        const modelMap = new Map<string, OpenRouterModelInfo>();
        for (const model of models) {
            if (model.id.trim()) {
                modelMap.set(model.id.toLowerCase(), model);
            }
        }
        const uniqueModels = Array.from(modelMap.values()).sort((a, b) => a.id.localeCompare(b.id));

        await fs.mkdir(path.dirname(this.cachePath), { recursive: true });

        const now = new Date();
        const cachePayload: CacheFile = {
            fetchedAt: now.toISOString(),
            models: uniqueModels,
        };

        await fs.writeFile(this.cachePath, JSON.stringify(cachePayload, null, 2), 'utf-8');

        this.models = new Map(uniqueModels.map((m) => [m.id.toLowerCase(), m]));
        this.lastFetchedAt = now.getTime();
    }

    private extractModels(payload: unknown): OpenRouterModelInfo[] {
        if (!payload) {
            return [];
        }

        const raw =
            (payload as { data?: unknown; models?: unknown }).data ??
            (payload as { data?: unknown; models?: unknown }).models ??
            payload;

        if (!Array.isArray(raw)) {
            return [];
        }

        const models: OpenRouterModelInfo[] = [];
        for (const item of raw) {
            if (item && typeof item === 'object') {
                const record = item as Record<string, unknown>;
                const id = this.firstString([record.id, record.model, record.name]);
                if (id) {
                    // Get context_length from item or top_provider
                    let contextLength = DEFAULT_CONTEXT_LENGTH;
                    if (typeof record.context_length === 'number') {
                        contextLength = record.context_length;
                    } else if (
                        record.top_provider &&
                        typeof record.top_provider === 'object' &&
                        typeof (record.top_provider as Record<string, unknown>).context_length ===
                            'number'
                    ) {
                        contextLength = (record.top_provider as Record<string, unknown>)
                            .context_length as number;
                    }
                    const displayName =
                        typeof record.name === 'string' && record.name.trim().length > 0
                            ? record.name
                            : undefined;
                    const expirationDate =
                        typeof record.expiration_date === 'string' &&
                        record.expiration_date.trim().length > 0
                            ? record.expiration_date
                            : undefined;
                    const supportedParameters = Array.isArray(record.supported_parameters)
                        ? record.supported_parameters.filter(
                              (p): p is string => typeof p === 'string' && p.trim().length > 0
                          )
                        : undefined;
                    models.push({
                        id,
                        contextLength,
                        ...(displayName ? { displayName } : {}),
                        ...(expirationDate ? { expirationDate } : {}),
                        ...(supportedParameters ? { supportedParameters } : {}),
                    });
                }
            }
        }
        return models;
    }

    private firstString(values: Array<unknown>): string | null {
        for (const value of values) {
            if (typeof value === 'string' && value.trim().length > 0) {
                return value;
            }
        }
        return null;
    }
}

// Singleton instance with global cache path
const cachePath = getDextoGlobalPath(CACHE_SUBDIR, CACHE_FILENAME);
export const openRouterModelRegistry = new OpenRouterModelRegistry(cachePath);

/**
 * Look up a model ID against the OpenRouter catalog.
 * @returns 'valid' if model exists, 'invalid' if not found, 'unknown' if cache is stale/empty
 */
export function lookupOpenRouterModel(modelId: string): LookupStatus {
    return openRouterModelRegistry.lookup(modelId);
}

/**
 * Schedule a non-blocking background refresh of the OpenRouter model cache.
 */
export function scheduleOpenRouterModelRefresh(options?: RefreshOptions): void {
    openRouterModelRegistry.scheduleRefresh(options);
}

/**
 * Perform a blocking refresh of the OpenRouter model cache.
 */
export async function refreshOpenRouterModelCache(options?: RefreshOptions): Promise<void> {
    await openRouterModelRegistry.refresh(options);
}

/**
 * Get all cached OpenRouter model IDs (or null if cache is empty).
 */
export function getCachedOpenRouterModels(): string[] | null {
    return openRouterModelRegistry.getCachedModels();
}

/**
 * Get all cached OpenRouter model info (or null if cache is empty).
 * Expired models are filtered out.
 */
export function getCachedOpenRouterModelsWithInfo(): OpenRouterModelInfo[] | null {
    return openRouterModelRegistry.getCachedModelsWithInfo();
}

/**
 * Get context length for an OpenRouter model.
 * @returns context length if model is in cache, null if not found or cache is stale
 */
export function getOpenRouterModelContextLength(modelId: string): number | null {
    return openRouterModelRegistry.getContextLength(modelId);
}

/**
 * Get model info for an OpenRouter model.
 * @returns model info if found in cache, null otherwise
 */
export function getOpenRouterModelInfo(modelId: string): OpenRouterModelInfo | null {
    return openRouterModelRegistry.getModelInfo(modelId);
}

/**
 * Get cache metadata for debugging/monitoring.
 */
export function getOpenRouterModelCacheInfo(): {
    lastFetchedAt: Date | null;
    modelCount: number;
    isFresh: boolean;
} {
    return openRouterModelRegistry.getCacheMetadata();
}

// Export internal constants for testing purposes
export const __TEST_ONLY__ = {
    cachePath,
    CACHE_TTL_MS,
};
