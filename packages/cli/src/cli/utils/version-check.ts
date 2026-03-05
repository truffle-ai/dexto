// packages/cli/src/cli/utils/version-check.ts

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import boxen from 'boxen';

/**
 * Version cache stored in ~/.dexto/cache/version-check.json
 */
interface VersionCache {
    lastCheck: number; // timestamp in ms
    latestVersion: string;
    currentVersion: string;
}

/**
 * Update info returned when a newer version is available
 */
export interface UpdateInfo {
    current: string;
    latest: string;
    updateCommand: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const GITHUB_RELEASES_LATEST_URL = 'https://api.github.com/repos/truffle-ai/dexto/releases/latest';
const CACHE_FILE_PATH = path.join(os.homedir(), '.dexto', 'cache', 'version-check.json');

function debugLog(message: string): void {
    if (process.env.DEXTO_DEBUG === 'true') {
        console.debug(`[version-check] ${message}`);
    }
}

/**
 * Compare two semver versions.
 * Returns:
 *  - negative if v1 < v2
 *  - 0 if v1 === v2
 *  - positive if v1 > v2
 *
 * Note: Pre-release versions (e.g., 1.0.0-beta.1) are not fully supported.
 * The comparison strips pre-release suffixes, so 1.0.0 and 1.0.0-beta.1
 * would be considered equal. This is acceptable for update notifications
 * since we don't publish pre-release versions to npm's latest tag.
 */
function compareSemver(v1: string, v2: string): number {
    const parse = (v: string) => {
        // Strip leading 'v' if present and split on '.'
        const cleaned = v.replace(/^v/, '');
        const parts = cleaned.split('.').map((p) => parseInt(p, 10) || 0);
        // Pad to 3 parts
        while (parts.length < 3) parts.push(0);
        return parts;
    };

    const p1 = parse(v1);
    const p2 = parse(v2);

    for (let i = 0; i < 3; i++) {
        const v1Part = p1[i] ?? 0;
        const v2Part = p2[i] ?? 0;
        if (v1Part !== v2Part) {
            return v1Part - v2Part;
        }
    }
    return 0;
}

/**
 * Load cached version info from disk
 */
async function loadCache(): Promise<VersionCache | null> {
    try {
        const content = await fs.readFile(CACHE_FILE_PATH, 'utf-8');
        return JSON.parse(content) as VersionCache;
    } catch {
        return null;
    }
}

/**
 * Save version cache to disk
 */
async function saveCache(cache: VersionCache): Promise<void> {
    try {
        await fs.mkdir(path.dirname(CACHE_FILE_PATH), { recursive: true });
        await fs.writeFile(CACHE_FILE_PATH, JSON.stringify(cache, null, 2));
    } catch (error) {
        // Non-critical - just log and continue
        debugLog(
            `Failed to save version cache: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

function normalizeReleaseTag(tagName: string): string | null {
    const trimmed = tagName.trim();
    if (trimmed.length === 0) {
        return null;
    }

    // GitHub releases in this monorepo can include scoped package tags like
    // "@dexto/tools-filesystem@1.6.10". Always extract a trailing semver.
    const trailingSemverMatch = trimmed.match(
        /(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/
    );
    if (!trailingSemverMatch) {
        return null;
    }

    const version = trailingSemverMatch[1]?.trim();
    return version && version.length > 0 ? version : null;
}

function extractLatestVersionFromRelease(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    const tagName = Reflect.get(payload, 'tag_name');
    if (typeof tagName !== 'string') {
        return null;
    }

    return normalizeReleaseTag(tagName);
}

/**
 * Fetch latest version from GitHub Releases
 */
async function fetchLatestVersion(): Promise<string | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    try {
        const response = await fetch(GITHUB_RELEASES_LATEST_URL, {
            signal: controller.signal,
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': 'dexto-cli-version-check',
            },
        });

        if (!response.ok) {
            debugLog(`GitHub releases API returned status ${response.status}`);
            return null;
        }

        const data = (await response.json()) as unknown;
        const latestVersion = extractLatestVersionFromRelease(data);
        if (!latestVersion) {
            debugLog('GitHub releases API response missing valid tag_name');
            return null;
        }

        return latestVersion;
    } catch (error) {
        // Network errors, timeouts, etc. - silent fail
        debugLog(
            `Failed to fetch latest version: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Check for updates (non-blocking, cached)
 *
 * @param currentVersion The current installed version
 * @returns UpdateInfo if a newer version is available, null otherwise
 *
 * This function is designed to be called at CLI startup. It:
 * - Respects DEXTO_NO_UPDATE_CHECK=true to disable checks
 * - Uses a 24-hour cache to avoid hammering npm
 * - Fails silently on network errors
 * - Never blocks startup for more than 5 seconds
 *
 * @example
 * ```typescript
 * const updateInfo = await checkForUpdates('1.5.4');
 * if (updateInfo) {
 *   displayUpdateNotification(updateInfo);
 * }
 * ```
 */
export async function checkForUpdates(currentVersion: string): Promise<UpdateInfo | null> {
    // Check if update checks are disabled
    if (process.env.DEXTO_NO_UPDATE_CHECK === 'true') {
        debugLog('Version check disabled via DEXTO_NO_UPDATE_CHECK');
        return null;
    }

    try {
        const now = Date.now();
        const cache = await loadCache();

        // Check if cache is valid
        if (cache && cache.currentVersion === currentVersion) {
            const cacheAge = now - cache.lastCheck;
            if (cacheAge < CACHE_TTL_MS) {
                debugLog(
                    `Using cached version info (age: ${Math.round(cacheAge / 1000 / 60)} minutes)`
                );
                // Return cached result if newer version exists
                if (compareSemver(cache.latestVersion, currentVersion) > 0) {
                    return {
                        current: currentVersion,
                        latest: cache.latestVersion,
                        updateCommand: 'dexto upgrade',
                    };
                }
                return null;
            }
        }

        // Cache expired or invalid - fetch from GitHub releases
        debugLog('Fetching latest version from GitHub releases');
        const latestVersion = await fetchLatestVersion();

        if (!latestVersion) {
            return null;
        }

        // Update cache
        const newCache: VersionCache = {
            lastCheck: now,
            latestVersion,
            currentVersion,
        };
        await saveCache(newCache);

        // Check if update is available
        if (compareSemver(latestVersion, currentVersion) > 0) {
            return {
                current: currentVersion,
                latest: latestVersion,
                updateCommand: 'dexto upgrade',
            };
        }

        return null;
    } catch (error) {
        // Never fail the CLI startup due to version check errors
        debugLog(`Version check error: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

/**
 * Display update notification in a styled box
 *
 * @param updateInfo Update information to display
 *
 * @example
 * ```typescript
 * displayUpdateNotification({
 *   current: '1.5.4',
 *   latest: '1.6.0',
 *   updateCommand: 'dexto upgrade'
 * });
 * ```
 */
export function displayUpdateNotification(updateInfo: UpdateInfo): void {
    const message =
        `Update available: ${chalk.gray(updateInfo.current)} ${chalk.gray('→')} ${chalk.green(updateInfo.latest)}\n` +
        `Run: ${chalk.cyan(updateInfo.updateCommand)}`;

    console.log(
        boxen(message, {
            padding: 1,
            margin: { top: 1, bottom: 1, left: 0, right: 0 },
            borderColor: 'yellow',
            borderStyle: 'round',
        })
    );
}
