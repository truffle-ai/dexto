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

interface CacheFile {
    fetchedAt: string;
    models: string[];
}

interface RefreshOptions {
    apiKey?: string;
    force?: boolean;
}

class OpenRouterModelRegistry {
    private models: Set<string> | null = null;
    private lastFetchedAt: number | null = null;
    private refreshPromise: Promise<void> | null = null;
    private lastRefreshAttemptAt: number | null = null;
    private lastUsedApiKey?: string;

    constructor(private readonly cachePath: string) {
        this.loadCacheFromDisk();
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

        if (!this.isCacheFresh()) {
            // Don't rely on stale data - refresh in background and treat as unknown
            this.scheduleRefresh();
            return 'unknown';
        }

        return this.models.has(normalized) ? 'valid' : 'invalid';
    }

    /**
     * Schedule a non-blocking background refresh of the model cache.
     */
    scheduleRefresh(options?: RefreshOptions): void {
        const apiKey = options?.apiKey ?? this.lastUsedApiKey;
        if (apiKey) {
            this.lastUsedApiKey = apiKey;
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
        this.refreshPromise = this.refreshInternal(apiKey)
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

        const promise = this.refreshInternal(apiKey).finally(() => {
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
        return Array.from(this.models.values());
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

    private async refreshInternal(apiKey?: string): Promise<void> {
        try {
            const headers: Record<string, string> = {
                Accept: 'application/json',
            };
            if (apiKey) {
                headers.Authorization = `Bearer ${apiKey}`;
            }

            logger.debug('Refreshing OpenRouter model registry from remote source');
            const response = await fetch(OPENROUTER_MODELS_ENDPOINT, { headers });
            if (!response.ok) {
                const body = await response.text();
                throw new Error(`HTTP ${response.status}: ${body}`);
            }

            const payload = await response.json();
            const models = this.extractModelIds(payload);
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

            this.models = new Set(parsed.models.map((m) => m.toLowerCase()));
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

    private async writeCache(models: string[]): Promise<void> {
        const uniqueModels = Array.from(new Set(models.map((m) => m.trim()))).filter(
            (m) => m.length > 0
        );
        uniqueModels.sort((a, b) => a.localeCompare(b));

        await fs.mkdir(path.dirname(this.cachePath), { recursive: true });

        const now = new Date();
        const cachePayload: CacheFile = {
            fetchedAt: now.toISOString(),
            models: uniqueModels,
        };

        await fs.writeFile(this.cachePath, JSON.stringify(cachePayload, null, 2), 'utf-8');

        this.models = new Set(uniqueModels.map((m) => m.toLowerCase()));
        this.lastFetchedAt = now.getTime();
    }

    private extractModelIds(payload: unknown): string[] {
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

        const ids: string[] = [];
        for (const item of raw) {
            if (typeof item === 'string') {
                ids.push(item);
                continue;
            }
            if (item && typeof item === 'object') {
                const maybeId = this.firstString([
                    (item as Record<string, unknown>).id,
                    (item as Record<string, unknown>).model,
                    (item as Record<string, unknown>).name,
                ]);
                if (maybeId) {
                    ids.push(maybeId);
                }
            }
        }
        return ids;
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
