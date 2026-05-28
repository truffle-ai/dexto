import { existsSync, readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getDextoGlobalPath, getPrimaryApiKeyEnvVar, type LLMProvider } from '@dexto/core';

const MODEL_AUTH_PROFILES_FILE = 'model-auth.yml';

export type ApiKeyEnvModelAuthCredential = {
    type: 'api_key_env';
    envVar: string;
};

export type OAuthModelAuthCredential = {
    type: 'oauth';
    issuer: string;
    refreshToken: string;
    accessToken: string;
    expiresAt: number;
    metadata?: Record<string, string> | undefined;
};

export type ModelAuthCredential = ApiKeyEnvModelAuthCredential | OAuthModelAuthCredential;

export type ModelAuthProfile = {
    id: string;
    providerId: string;
    methodId: string;
    label: string;
    credential: ModelAuthCredential;
    createdAt: string;
    updatedAt: string;
};

type ModelAuthProfileDraft = Omit<ModelAuthProfile, 'createdAt' | 'updatedAt'>;

export type ModelAuthProfilesFile = {
    version: 1;
    defaults: Record<string, string>;
    profiles: ModelAuthProfile[];
};

const EMPTY_MODEL_AUTH_PROFILES: ModelAuthProfilesFile = {
    version: 1,
    defaults: {},
    profiles: [],
};

export function getModelAuthProfilesPath(): string {
    return getDextoGlobalPath('', MODEL_AUTH_PROFILES_FILE);
}

export function getModelAuthProfileId(providerId: string, methodId: string): string {
    return `${providerId}:${methodId}`;
}

function nowIso(): string {
    return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}

function isStringRecord(value: unknown): value is Record<string, string> {
    if (!isRecord(value)) {
        return false;
    }

    return Object.values(value).every((item) => typeof item === 'string');
}

function isCredential(value: unknown): value is ModelAuthCredential {
    if (!isRecord(value)) {
        return false;
    }

    if (value.type === 'api_key_env') {
        return typeof value.envVar === 'string';
    }

    if (value.type !== 'oauth') {
        return false;
    }

    return (
        typeof value.issuer === 'string' &&
        typeof value.refreshToken === 'string' &&
        typeof value.accessToken === 'string' &&
        typeof value.expiresAt === 'number' &&
        (value.metadata === undefined || isStringRecord(value.metadata))
    );
}

function isModelAuthProfile(value: unknown): value is ModelAuthProfile {
    if (!isRecord(value)) {
        return false;
    }

    return (
        typeof value.id === 'string' &&
        typeof value.providerId === 'string' &&
        typeof value.methodId === 'string' &&
        typeof value.label === 'string' &&
        isCredential(value.credential) &&
        typeof value.createdAt === 'string' &&
        typeof value.updatedAt === 'string'
    );
}

function parseDefaults(rawDefaults: unknown): Record<string, string> {
    return isStringRecord(rawDefaults) ? rawDefaults : {};
}

function parseModelAuthProfiles(raw: unknown): ModelAuthProfilesFile {
    if (!isRecord(raw)) {
        return EMPTY_MODEL_AUTH_PROFILES;
    }

    if (raw.version !== 1 || !Array.isArray(raw.profiles)) {
        return EMPTY_MODEL_AUTH_PROFILES;
    }

    return {
        version: 1,
        defaults: parseDefaults(raw.defaults),
        profiles: raw.profiles.filter(isModelAuthProfile),
    };
}

export function loadModelAuthProfilesSync(): ModelAuthProfilesFile {
    const profilesPath = getModelAuthProfilesPath();
    if (!existsSync(profilesPath)) {
        return EMPTY_MODEL_AUTH_PROFILES;
    }

    const raw = parseYaml(readFileSync(profilesPath, 'utf-8'));
    return parseModelAuthProfiles(raw);
}

export async function loadModelAuthProfiles(): Promise<ModelAuthProfilesFile> {
    const profilesPath = getModelAuthProfilesPath();
    if (!existsSync(profilesPath)) {
        return EMPTY_MODEL_AUTH_PROFILES;
    }

    const raw = parseYaml(await fs.readFile(profilesPath, 'utf-8'));
    return parseModelAuthProfiles(raw);
}

async function saveModelAuthProfiles(profiles: ModelAuthProfilesFile): Promise<void> {
    const profilesPath = getModelAuthProfilesPath();
    await fs.mkdir(path.dirname(profilesPath), { recursive: true });
    await fs.writeFile(
        profilesPath,
        stringifyYaml(profiles, {
            indent: 2,
            lineWidth: 100,
            minContentWidth: 20,
        }),
        'utf-8'
    );
    await fs.chmod(profilesPath, 0o600);
}

export function listModelAuthProfiles(
    profiles: ModelAuthProfilesFile,
    providerId?: string
): ModelAuthProfile[] {
    const filtered = providerId
        ? profiles.profiles.filter((profile) => profile.providerId === providerId)
        : profiles.profiles;
    return [...filtered].sort((a, b) => a.id.localeCompare(b.id));
}

export async function listSavedModelAuthProfiles(providerId?: string): Promise<ModelAuthProfile[]> {
    return listModelAuthProfiles(await loadModelAuthProfiles(), providerId);
}

export function getDefaultModelAuthProfile(
    profiles: ModelAuthProfilesFile,
    providerId: string
): ModelAuthProfile | null {
    const defaultId = profiles.defaults[providerId];
    if (!defaultId) {
        return null;
    }

    return (
        profiles.profiles.find(
            (profile) => profile.id === defaultId && profile.providerId === providerId
        ) ?? null
    );
}

export async function getDefaultModelAuthProfileIdForProvider(
    providerId: string
): Promise<string | null> {
    const profiles = await loadModelAuthProfiles();
    const defaultId = profiles.defaults[providerId];
    return defaultId &&
        profiles.profiles.some(
            (profile) => profile.id === defaultId && profile.providerId === providerId
        )
        ? defaultId
        : null;
}

export async function setDefaultModelAuthProfile(input: {
    providerId: string;
    profileId: string | null;
}): Promise<void> {
    const profiles = await loadModelAuthProfiles();
    if (input.profileId === null) {
        const { [input.providerId]: _removed, ...defaults } = profiles.defaults;
        await saveModelAuthProfiles({ ...profiles, defaults });
        return;
    }

    const profile = profiles.profiles.find((item) => item.id === input.profileId);
    if (!profile) {
        throw new Error(`Model auth profile not found: ${input.profileId}`);
    }
    if (profile.providerId !== input.providerId) {
        throw new Error(
            `Model auth profile provider mismatch: ${profile.providerId} is not ${input.providerId}`
        );
    }

    await saveModelAuthProfiles({
        ...profiles,
        defaults: {
            ...profiles.defaults,
            [input.providerId]: input.profileId,
        },
    });
}

export async function deleteModelAuthProfile(profileId: string): Promise<boolean> {
    const profiles = await loadModelAuthProfiles();
    const exists = profiles.profiles.some((profile) => profile.id === profileId);
    if (!exists) {
        return false;
    }

    const defaults = Object.fromEntries(
        Object.entries(profiles.defaults).filter(
            ([, defaultProfileId]) => defaultProfileId !== profileId
        )
    );
    await saveModelAuthProfiles({
        version: 1,
        defaults,
        profiles: profiles.profiles.filter((profile) => profile.id !== profileId),
    });
    return true;
}

export async function upsertModelAuthProfile(
    profile: ModelAuthProfileDraft
): Promise<ModelAuthProfile> {
    const existing = await loadModelAuthProfiles();
    const timestamp = nowIso();
    const current = existing.profiles.find((item) => item.id === profile.id);
    const saved: ModelAuthProfile = {
        ...profile,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
    };

    await saveModelAuthProfiles({
        version: 1,
        defaults: {
            ...existing.defaults,
            [profile.providerId]: profile.id,
        },
        profiles: [...existing.profiles.filter((item) => item.id !== profile.id), saved],
    });
    return saved;
}

export async function saveApiKeyModelAuthProfile(
    providerId: LLMProvider
): Promise<ModelAuthProfile> {
    return upsertModelAuthProfile({
        id: getModelAuthProfileId(providerId, 'api_key'),
        providerId,
        methodId: 'api_key',
        label: 'API key',
        credential: {
            type: 'api_key_env',
            envVar: getPrimaryApiKeyEnvVar(providerId),
        },
    });
}
