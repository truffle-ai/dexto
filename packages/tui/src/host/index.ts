import type { DextoAgent, LLMProvider } from '@dexto/core';

export interface TuiAuthConfig {
    token?: string | undefined;
    refreshToken?: string | undefined;
    userId?: string | undefined;
    email?: string | undefined;
    expiresAt?: number | undefined;
    createdAt: number;
    dextoApiKey?: string | undefined;
    dextoKeyId?: string | undefined;
    dextoApiKeySource?: 'provisioned' | 'user-supplied' | undefined;
}

export interface TuiOAuthConfig {
    authUrl: string;
    clientId: string;
    provider?: string;
    scopes?: string[];
}

export interface TuiOAuthResult {
    accessToken: string;
    refreshToken?: string | undefined;
    expiresIn?: number | undefined;
    user?:
        | {
              id: string;
              email: string;
              name?: string | undefined;
          }
        | undefined;
}

export interface TuiOAuthLoginSession {
    authUrl: string;
    result: Promise<TuiOAuthResult>;
}

export type TuiDextoApiKeyProvisionStatusLevel = 'info' | 'success' | 'warning' | 'error';

export interface TuiDextoApiKeyProvisionStatus {
    level: TuiDextoApiKeyProvisionStatusLevel;
    message: string;
}

export interface TuiHostAdapter {
    registerGracefulShutdown?: (getAgent: () => DextoAgent, options: { inkMode: boolean }) => void;
    capture?: (event: string, properties?: Record<string, unknown>) => void;
    applyLayeredEnvironmentLoading?: () => Promise<void>;
    getProviderDisplayName?: (provider: LLMProvider | string) => string;
    isValidApiKeyFormat?: (apiKey: string, provider: LLMProvider) => boolean;
    getProviderInstructions?: (
        provider: LLMProvider
    ) => { title: string; content: string; url?: string | undefined } | null;
    beginOAuthLogin?: (
        config: TuiOAuthConfig,
        options?: { signal?: AbortSignal | undefined }
    ) => Promise<TuiOAuthLoginSession>;
    defaultOAuthConfig?: TuiOAuthConfig;
    ensureDextoApiKeyForAuthToken?: (
        authToken: string,
        options?: {
            onStatus?: ((status: TuiDextoApiKeyProvisionStatus) => void) | undefined;
        }
    ) => Promise<{ dextoApiKey: string; keyId: string | null } | null>;
    loadAuth?: () => Promise<TuiAuthConfig | null>;
    storeAuth?: (config: TuiAuthConfig) => Promise<void>;
    removeAuth?: () => Promise<void>;
    removeDextoApiKeyFromEnv?: (options?: {
        expectedValue?: string;
    }) => Promise<{ removed: boolean; targetEnvPath: string }>;
    isUsingDextoCredits?: () => Promise<boolean>;
    canUseDextoProvider?: () => Promise<boolean>;
}

let hostAdapter: TuiHostAdapter = {};

export function setTuiHostAdapter(adapter: TuiHostAdapter): void {
    hostAdapter = { ...adapter };
}

export function getTuiHostAdapter(): TuiHostAdapter {
    return hostAdapter;
}

function missingHostMethod(methodName: string): Error {
    return new Error(`TUI host adapter missing required method: ${methodName}`);
}

export function registerGracefulShutdown(
    getAgent: () => DextoAgent,
    options: { inkMode: boolean }
): void {
    hostAdapter.registerGracefulShutdown?.(getAgent, options);
}

export function captureAnalytics(event: string, properties?: Record<string, unknown>): void {
    hostAdapter.capture?.(event, properties);
}

export async function applyLayeredEnvironmentLoading(): Promise<void> {
    if (hostAdapter.applyLayeredEnvironmentLoading) {
        await hostAdapter.applyLayeredEnvironmentLoading();
    }
}

export function getProviderDisplayName(provider: LLMProvider | string): string {
    return hostAdapter.getProviderDisplayName?.(provider) ?? String(provider);
}

export function isValidApiKeyFormat(apiKey: string, provider: LLMProvider): boolean {
    return hostAdapter.isValidApiKeyFormat?.(apiKey, provider) ?? apiKey.trim().length > 0;
}

export function getProviderInstructions(provider: LLMProvider): {
    title: string;
    content: string;
    url?: string | undefined;
} | null {
    return hostAdapter.getProviderInstructions?.(provider) ?? null;
}

export function getDefaultOAuthConfig(): TuiOAuthConfig {
    const config = hostAdapter.defaultOAuthConfig;
    if (!config) {
        throw missingHostMethod('defaultOAuthConfig');
    }
    return config;
}

export async function beginOAuthLogin(
    config: TuiOAuthConfig,
    options?: { signal?: AbortSignal | undefined }
): Promise<TuiOAuthLoginSession> {
    if (!hostAdapter.beginOAuthLogin) {
        throw missingHostMethod('beginOAuthLogin');
    }
    return hostAdapter.beginOAuthLogin(config, options);
}

export async function ensureDextoApiKeyForAuthToken(
    authToken: string,
    options?: { onStatus?: ((status: TuiDextoApiKeyProvisionStatus) => void) | undefined }
): Promise<{ dextoApiKey: string; keyId: string | null } | null> {
    if (!hostAdapter.ensureDextoApiKeyForAuthToken) {
        throw missingHostMethod('ensureDextoApiKeyForAuthToken');
    }
    return hostAdapter.ensureDextoApiKeyForAuthToken(authToken, options);
}

export async function loadAuth(): Promise<TuiAuthConfig | null> {
    if (!hostAdapter.loadAuth) {
        throw missingHostMethod('loadAuth');
    }
    return hostAdapter.loadAuth();
}

export async function storeAuth(config: TuiAuthConfig): Promise<void> {
    if (!hostAdapter.storeAuth) {
        throw missingHostMethod('storeAuth');
    }
    await hostAdapter.storeAuth(config);
}

export async function removeAuth(): Promise<void> {
    if (!hostAdapter.removeAuth) {
        throw missingHostMethod('removeAuth');
    }
    await hostAdapter.removeAuth();
}

export async function removeDextoApiKeyFromEnv(options?: {
    expectedValue?: string;
}): Promise<{ removed: boolean; targetEnvPath: string }> {
    if (!hostAdapter.removeDextoApiKeyFromEnv) {
        throw missingHostMethod('removeDextoApiKeyFromEnv');
    }
    return hostAdapter.removeDextoApiKeyFromEnv(options);
}

export async function isUsingDextoCredits(): Promise<boolean> {
    if (!hostAdapter.isUsingDextoCredits) {
        throw missingHostMethod('isUsingDextoCredits');
    }
    return hostAdapter.isUsingDextoCredits();
}

export async function canUseDextoProvider(): Promise<boolean> {
    if (!hostAdapter.canUseDextoProvider) {
        throw missingHostMethod('canUseDextoProvider');
    }
    return hostAdapter.canUseDextoProvider();
}
