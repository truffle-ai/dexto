import { existsSync, readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
    getDextoGlobalPath,
    getPrimaryApiKeyEnvVar,
    LLM_PROVIDERS,
    type LlmAuthResolver,
    type LLMProvider,
} from '@dexto/core';
import {
    createChatGPTRuntimeAuth,
    type ChatGPTOAuthCredential,
    type ChatGPTRuntimeAuth,
} from './chatgpt-oauth.js';

const MODEL_AUTH_PROFILES_FILE = 'model-auth.yml';

export type ApiKeyModelAuthProfile = {
    id: string;
    providerId: LLMProvider;
    methodId: 'api_key';
    label: string;
    apiKeyEnvVar: string;
    createdAt: string;
    updatedAt: string;
};

export type OAuthModelAuthProfile = {
    id: string;
    providerId: LLMProvider;
    methodId: 'chatgpt_login';
    label: string;
    credential: ChatGPTOAuthCredential;
    createdAt: string;
    updatedAt: string;
};

export type ModelAuthProfile = ApiKeyModelAuthProfile | OAuthModelAuthProfile;
type ModelAuthProfileDraft =
    | Omit<ApiKeyModelAuthProfile, 'createdAt' | 'updatedAt'>
    | Omit<OAuthModelAuthProfile, 'createdAt' | 'updatedAt'>;

export type ModelAuthProfilesFile = {
    version: 1;
    defaults: Partial<Record<LLMProvider, string>>;
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

function nowIso(): string {
    return new Date().toISOString();
}

function profileId(providerId: LLMProvider, methodId: string): string {
    return `${providerId}:${methodId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
}

function isProviderId(value: unknown): value is LLMProvider {
    return typeof value === 'string' && LLM_PROVIDERS.some((provider) => provider === value);
}

function isChatGPTOAuthCredential(value: unknown): value is ChatGPTOAuthCredential {
    if (!isRecord(value)) {
        return false;
    }

    return (
        value.type === 'oauth' &&
        value.issuer === 'https://auth.openai.com' &&
        typeof value.refreshToken === 'string' &&
        typeof value.accessToken === 'string' &&
        typeof value.expiresAt === 'number' &&
        (value.accountId === undefined || typeof value.accountId === 'string')
    );
}

function isModelAuthProfile(value: unknown): value is ModelAuthProfile {
    if (!isRecord(value)) {
        return false;
    }

    const hasBaseFields =
        typeof value.id === 'string' &&
        isProviderId(value.providerId) &&
        typeof value.label === 'string' &&
        typeof value.createdAt === 'string' &&
        typeof value.updatedAt === 'string';
    if (!hasBaseFields) {
        return false;
    }

    if (value.methodId === 'api_key') {
        return typeof value.apiKeyEnvVar === 'string';
    }

    if (value.methodId === 'chatgpt_login') {
        return isChatGPTOAuthCredential(value.credential);
    }

    return false;
}

function parseDefaults(rawDefaults: unknown): Partial<Record<LLMProvider, string>> {
    if (!isRecord(rawDefaults)) {
        return {};
    }

    const defaults: Partial<Record<LLMProvider, string>> = {};
    for (const [providerId, profileId] of Object.entries(rawDefaults)) {
        if (isProviderId(providerId) && typeof profileId === 'string') {
            defaults[providerId] = profileId;
        }
    }
    return defaults;
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

function upsertProfile(
    existing: ModelAuthProfilesFile,
    profile: ModelAuthProfileDraft
): ModelAuthProfilesFile {
    const timestamp = nowIso();
    const current = existing.profiles.find((item) => item.id === profile.id);
    const baseFields = {
        id: profile.id,
        providerId: profile.providerId,
        methodId: profile.methodId,
        label: profile.label,
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp,
    };
    const nextProfile: ModelAuthProfile =
        profile.methodId === 'api_key'
            ? {
                  ...baseFields,
                  methodId: 'api_key',
                  apiKeyEnvVar: profile.apiKeyEnvVar,
              }
            : {
                  ...baseFields,
                  methodId: 'chatgpt_login',
                  credential: profile.credential,
              };

    return {
        version: 1,
        defaults: {
            ...existing.defaults,
            [profile.providerId]: profile.id,
        },
        profiles: [...existing.profiles.filter((item) => item.id !== profile.id), nextProfile],
    };
}

export async function saveApiKeyModelAuthProfile(
    providerId: LLMProvider
): Promise<ModelAuthProfile> {
    const existing = await loadModelAuthProfiles();
    const profile: ModelAuthProfileDraft = {
        id: profileId(providerId, 'api_key'),
        providerId,
        methodId: 'api_key',
        label: 'API key',
        apiKeyEnvVar: getPrimaryApiKeyEnvVar(providerId),
    };
    const next = upsertProfile(existing, profile);
    await saveModelAuthProfiles(next);
    const saved = next.profiles.find((item) => item.id === profile.id);
    if (!saved) {
        throw new Error(`Failed to save model auth profile ${profile.id}`);
    }
    return saved;
}

export async function saveChatGPTLoginModelAuthProfile(
    credential: ChatGPTOAuthCredential
): Promise<ModelAuthProfile> {
    const existing = await loadModelAuthProfiles();
    const profile: ModelAuthProfileDraft = {
        id: profileId('openai', 'chatgpt_login'),
        providerId: 'openai',
        methodId: 'chatgpt_login',
        label: 'ChatGPT Login',
        credential,
    };
    const next = upsertProfile(existing, profile);
    await saveModelAuthProfiles(next);
    const saved = next.profiles.find((item) => item.id === profile.id);
    if (!saved) {
        throw new Error(`Failed to save model auth profile ${profile.id}`);
    }
    return saved;
}

async function updateChatGPTLoginCredential(credential: ChatGPTOAuthCredential): Promise<void> {
    await saveChatGPTLoginModelAuthProfile(credential);
}

export function getDefaultModelAuthProfile(
    profiles: ModelAuthProfilesFile,
    providerId: LLMProvider
): ModelAuthProfile | null {
    const defaultId = profiles.defaults[providerId];
    if (!defaultId) {
        return null;
    }

    return profiles.profiles.find((profile) => profile.id === defaultId) ?? null;
}

export function createModelAuthResolver(): LlmAuthResolver {
    return {
        resolveRuntimeAuth(input) {
            const profile = getDefaultModelAuthProfile(loadModelAuthProfilesSync(), input.provider);
            if (!profile) {
                return null;
            }

            if (profile.methodId === 'api_key') {
                const apiKey = process.env[profile.apiKeyEnvVar]?.trim();
                return apiKey ? { apiKey } : null;
            }

            return createChatGPTRuntimeAuth({
                credential: profile.credential,
                updateCredential: updateChatGPTLoginCredential,
            }) satisfies ChatGPTRuntimeAuth;
        },
    };
}
