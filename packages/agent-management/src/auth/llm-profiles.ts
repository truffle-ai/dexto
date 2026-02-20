/**
 * LLM Auth Profiles Store
 *
 * Stores per-provider credential profiles (API keys, OAuth tokens, etc.) in:
 *   ~/.dexto/auth/llm-profiles.json
 *
 * Security:
 * - File permissions are forced to 0o600
 * - Writes are atomic (tmp + rename)
 */

import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { NonEmptyTrimmed } from '@dexto/core';

import { getDextoGlobalPath } from '../utils/path.js';

const STORE_VERSION = 1 as const;
const STORE_DIR = 'auth';
const STORE_FILENAME = 'llm-profiles.json';

const FILE_MODE = 0o600;
const STORE_LOCK_TIMEOUT_MS = 15_000;
const STORE_LOCK_STALE_MS = 15_000;
const STORE_LOCK_RETRY_DELAY_MS = 50;

export const LlmAuthCredentialSchema = z
    .discriminatedUnion('type', [
        z
            .object({
                type: z.literal('api_key'),
                key: NonEmptyTrimmed.describe('Provider API key'),
            })
            .strict(),
        z
            .object({
                type: z.literal('token'),
                token: NonEmptyTrimmed.describe('Static bearer token / setup token'),
                expiresAt: z.number().int().positive().optional().describe('Expiry timestamp (ms)'),
            })
            .strict(),
        z
            .object({
                type: z.literal('oauth'),
                accessToken: NonEmptyTrimmed,
                refreshToken: NonEmptyTrimmed,
                expiresAt: z.number().int().positive().describe('Expiry timestamp (ms)'),
                tokenType: z.string().optional().describe('Token type (e.g., Bearer)'),
                /**
                 * Optional provider-specific metadata (account IDs, resource URLs, regions).
                 * Keep as string map so we can store small bits of info without schema churn.
                 */
                metadata: z.record(z.string(), z.string()).optional(),
            })
            .strict(),
    ])
    .describe('Credential material for an auth profile');

export type LlmAuthCredential = z.output<typeof LlmAuthCredentialSchema>;

export const LlmAuthProfileSchema = z
    .object({
        profileId: NonEmptyTrimmed.describe('Stable profile identifier (e.g., openai:default)'),
        providerId: NonEmptyTrimmed.describe('Provider id (LLM provider or preset id)'),
        methodId: NonEmptyTrimmed.describe('Auth method id (e.g., api_key, oauth_codex)'),
        label: z.string().optional().describe('Human-friendly label'),
        credential: LlmAuthCredentialSchema,
        createdAt: z.number().int().positive(),
        updatedAt: z.number().int().positive(),
    })
    .strict();

export type LlmAuthProfile = z.output<typeof LlmAuthProfileSchema>;

export const LlmAuthProfilesStoreSchema = z
    .object({
        version: z.literal(STORE_VERSION),
        defaults: z.record(z.string(), z.string()).describe('providerId -> profileId'),
        profiles: z.record(z.string(), LlmAuthProfileSchema).describe('profileId -> profile'),
    })
    .strict();

export type LlmAuthProfilesStore = z.output<typeof LlmAuthProfilesStoreSchema>;

export function getLlmAuthProfilesPath(): string {
    return getDextoGlobalPath(STORE_DIR, STORE_FILENAME);
}

function getStoreLockPath(storePath: string): string {
    return `${storePath}.lock`;
}

function createEmptyStore(): LlmAuthProfilesStore {
    return { version: STORE_VERSION, defaults: {}, profiles: {} };
}

function createCorruptBackupPath(storePath: string): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    return `${storePath}.corrupt.${ts}.${randomUUID()}`;
}

async function backupCorruptStoreFile(storePath: string): Promise<void> {
    const backupPath = createCorruptBackupPath(storePath);
    try {
        await fs.rename(storePath, backupPath);
        await fs.chmod(backupPath, FILE_MODE).catch(() => undefined);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
    }
}

function backupCorruptStoreFileSync(storePath: string): void {
    const backupPath = createCorruptBackupPath(storePath);
    try {
        renameSync(storePath, backupPath);
        try {
            chmodSync(backupPath, FILE_MODE);
        } catch {
            // ignore chmod failures
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
    }
}

async function maybeRemoveStaleLock(lockPath: string): Promise<void> {
    try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > STORE_LOCK_STALE_MS) {
            await fs.unlink(lockPath);
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
    }
}

async function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
    const storePath = getLlmAuthProfilesPath();
    const lockPath = getStoreLockPath(storePath);

    await fs.mkdir(path.dirname(storePath), { recursive: true });

    const startedAt = Date.now();
    while (true) {
        try {
            const handle = await fs.open(lockPath, 'wx', FILE_MODE);
            try {
                await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, 'utf-8');
            } finally {
                await handle.close();
            }
            await fs.chmod(lockPath, FILE_MODE).catch(() => undefined);
            break;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            await maybeRemoveStaleLock(lockPath);
            if (Date.now() - startedAt > STORE_LOCK_TIMEOUT_MS) {
                throw new Error(`Timed out acquiring LLM auth store lock: ${lockPath}`);
            }
            await new Promise((resolve) => setTimeout(resolve, STORE_LOCK_RETRY_DELAY_MS));
        }
    }

    try {
        return await fn();
    } finally {
        await fs.unlink(lockPath).catch(() => undefined);
    }
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(tmpPath, content, { encoding: 'utf-8', mode: FILE_MODE });
        await fs.rename(tmpPath, filePath);
        // Enforce permissions even if file existed previously with different mode.
        await fs.chmod(filePath, FILE_MODE);
    } catch (error) {
        try {
            await fs.unlink(tmpPath);
        } catch {
            // ignore cleanup errors
        }
        throw error;
    }
}

export async function loadLlmAuthProfilesStore(): Promise<LlmAuthProfilesStore> {
    const filePath = getLlmAuthProfilesPath();

    if (!existsSync(filePath)) {
        return createEmptyStore();
    }

    try {
        const content = await fs.readFile(filePath, 'utf-8');
        let decoded: unknown;
        try {
            decoded = JSON.parse(content) as unknown;
        } catch {
            await backupCorruptStoreFile(filePath);
            return createEmptyStore();
        }

        const parsed = LlmAuthProfilesStoreSchema.safeParse(decoded);
        if (!parsed.success) {
            await backupCorruptStoreFile(filePath);
            return createEmptyStore();
        }
        return parsed.data;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return createEmptyStore();
        }
        throw error;
    }
}

export function loadLlmAuthProfilesStoreSync(): LlmAuthProfilesStore {
    const filePath = getLlmAuthProfilesPath();
    if (!existsSync(filePath)) {
        return createEmptyStore();
    }

    try {
        const content = readFileSync(filePath, 'utf-8');
        let decoded: unknown;
        try {
            decoded = JSON.parse(content) as unknown;
        } catch {
            backupCorruptStoreFileSync(filePath);
            return createEmptyStore();
        }

        const parsed = LlmAuthProfilesStoreSchema.safeParse(decoded);
        if (!parsed.success) {
            backupCorruptStoreFileSync(filePath);
            return createEmptyStore();
        }
        return parsed.data;
    } catch {
        return createEmptyStore();
    }
}

export async function saveLlmAuthProfilesStore(store: LlmAuthProfilesStore): Promise<void> {
    const parsed = LlmAuthProfilesStoreSchema.safeParse(store);
    if (!parsed.success) {
        throw new Error(
            `Invalid LLM auth profiles store: ${parsed.error.issues.map((i) => i.message).join(', ')}`
        );
    }

    const filePath = getLlmAuthProfilesPath();
    await writeFileAtomic(filePath, JSON.stringify(parsed.data, null, 2));
}

export async function listLlmAuthProfiles(options?: {
    providerId?: string | undefined;
}): Promise<LlmAuthProfile[]> {
    const store = await loadLlmAuthProfilesStore();
    const profiles = Object.values(store.profiles);
    const filtered = options?.providerId
        ? profiles.filter((p) => p.providerId === options.providerId)
        : profiles;
    filtered.sort((a, b) => a.profileId.localeCompare(b.profileId));
    return filtered;
}

export async function upsertLlmAuthProfile(input: {
    profileId: string;
    providerId: string;
    methodId: string;
    label?: string | undefined;
    credential: LlmAuthCredential;
}): Promise<LlmAuthProfile> {
    return await withStoreLock(async () => {
        const now = Date.now();
        const store = await loadLlmAuthProfilesStore();
        const existing = store.profiles[input.profileId];

        const next: LlmAuthProfile = {
            profileId: input.profileId,
            providerId: input.providerId,
            methodId: input.methodId,
            ...(input.label ? { label: input.label } : {}),
            credential: input.credential,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
        };

        const validated = LlmAuthProfileSchema.parse(next);
        store.profiles[validated.profileId] = validated;
        await saveLlmAuthProfilesStore(store);
        return validated;
    });
}

export async function deleteLlmAuthProfile(profileId: string): Promise<boolean> {
    return await withStoreLock(async () => {
        const store = await loadLlmAuthProfilesStore();
        if (!store.profiles[profileId]) return false;

        delete store.profiles[profileId];
        for (const [providerId, defaultProfileId] of Object.entries(store.defaults)) {
            if (defaultProfileId === profileId) {
                delete store.defaults[providerId];
            }
        }

        await saveLlmAuthProfilesStore(store);
        return true;
    });
}

export async function setDefaultLlmAuthProfile(options: {
    providerId: string;
    profileId: string | null;
}): Promise<void> {
    return await withStoreLock(async () => {
        const store = await loadLlmAuthProfilesStore();

        if (options.profileId === null) {
            delete store.defaults[options.providerId];
            await saveLlmAuthProfilesStore(store);
            return;
        }

        const profile = store.profiles[options.profileId];
        if (!profile) {
            throw new Error(`Profile not found: ${options.profileId}`);
        }
        if (profile.providerId !== options.providerId) {
            throw new Error(
                `Profile provider mismatch: expected ${options.providerId}, got ${profile.providerId}`
            );
        }

        store.defaults[options.providerId] = options.profileId;
        await saveLlmAuthProfilesStore(store);
    });
}

export async function getDefaultLlmAuthProfileId(providerId: string): Promise<string | null> {
    const store = await loadLlmAuthProfilesStore();
    const profileId = store.defaults[providerId];
    if (!profileId) return null;
    return store.profiles[profileId] ? profileId : null;
}

export function getDefaultLlmAuthProfileIdSync(providerId: string): string | null {
    const store = loadLlmAuthProfilesStoreSync();
    const profileId = store.defaults[providerId];
    if (!profileId) return null;
    return store.profiles[profileId] ? profileId : null;
}

export async function getLlmAuthProfile(profileId: string): Promise<LlmAuthProfile | null> {
    const store = await loadLlmAuthProfilesStore();
    return store.profiles[profileId] ?? null;
}

export function getLlmAuthProfileSync(profileId: string): LlmAuthProfile | null {
    const store = loadLlmAuthProfilesStoreSync();
    return store.profiles[profileId] ?? null;
}
