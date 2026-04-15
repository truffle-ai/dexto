import type { LLMProvider } from '@dexto/core';
import type { TuiAgentBackend } from '../agent-backend.js';

export interface TuiShutdownHandle {
    stop?: (() => Promise<void>) | undefined;
}

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

export interface TuiDeviceLoginPrompt {
    userCode: string;
    verificationUrl: string;
    verificationUrlComplete: string | null;
    expiresIn: number;
}

export type TuiDextoApiKeyProvisionStatusLevel = 'info' | 'success' | 'warning' | 'error';

export interface TuiDextoApiKeyProvisionStatus {
    level: TuiDextoApiKeyProvisionStatusLevel;
    message: string;
}

export interface TuiPersistedLoginResult {
    email?: string | undefined;
    userId?: string | undefined;
    keyId?: string | undefined;
    hasDextoApiKey: boolean;
}

export interface TuiRuntimeServices {
    registerGracefulShutdown?: (
        getAgent: () => TuiShutdownHandle,
        options: { inkMode: boolean }
    ) => void;
    capture?: (event: string, properties?: Record<string, unknown>) => void;
    applyLayeredEnvironmentLoading?: () => Promise<void>;
    getProviderDisplayName?: (provider: LLMProvider | string) => string;
    isValidApiKeyFormat?: (apiKey: string, provider: LLMProvider) => boolean;
    getProviderInstructions?: (
        provider: LLMProvider
    ) => { title: string; content: string; url?: string | undefined } | null;
    performDeviceCodeLogin?: (options?: {
        signal?: AbortSignal | undefined;
        onPrompt?: ((prompt: TuiDeviceLoginPrompt) => void) | undefined;
    }) => Promise<TuiOAuthResult>;
    persistOAuthLoginResult?: (
        result: TuiOAuthResult,
        options?: {
            onProvisionStatus?: ((status: TuiDextoApiKeyProvisionStatus) => void) | undefined;
        }
    ) => Promise<TuiPersistedLoginResult>;
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
    buildDextoBillingUrl?: (options: { creditsUsd: number }) => string;
    openDextoBillingPage?: (options: { url?: string | undefined }) => Promise<void>;
}

let runtimeServices: TuiRuntimeServices = {};

export function setTuiRuntimeServices(adapter: TuiRuntimeServices): void {
    runtimeServices = { ...adapter };
}

export function getTuiRuntimeServices(): TuiRuntimeServices {
    return runtimeServices;
}

function missingHostMethod(methodName: string): Error {
    return new Error(`TUI runtime services missing required method: ${methodName}`);
}

export function registerGracefulShutdown(
    getAgent: () => TuiAgentBackend,
    options: { inkMode: boolean }
): void {
    runtimeServices.registerGracefulShutdown?.(getAgent, options);
}

export function captureAnalytics(event: string, properties?: Record<string, unknown>): void {
    runtimeServices.capture?.(event, properties);
}

export async function applyLayeredEnvironmentLoading(): Promise<void> {
    if (runtimeServices.applyLayeredEnvironmentLoading) {
        await runtimeServices.applyLayeredEnvironmentLoading();
    }
}

export function getProviderDisplayName(provider: LLMProvider | string): string {
    return runtimeServices.getProviderDisplayName?.(provider) ?? String(provider);
}

export function isValidApiKeyFormat(apiKey: string, provider: LLMProvider): boolean {
    return runtimeServices.isValidApiKeyFormat?.(apiKey, provider) ?? apiKey.trim().length > 0;
}

export function getProviderInstructions(provider: LLMProvider): {
    title: string;
    content: string;
    url?: string | undefined;
} | null {
    return runtimeServices.getProviderInstructions?.(provider) ?? null;
}

export async function performDeviceCodeLogin(options?: {
    signal?: AbortSignal | undefined;
    onPrompt?: ((prompt: TuiDeviceLoginPrompt) => void) | undefined;
}): Promise<TuiOAuthResult> {
    if (!runtimeServices.performDeviceCodeLogin) {
        throw missingHostMethod('performDeviceCodeLogin');
    }
    return runtimeServices.performDeviceCodeLogin(options);
}

export async function persistOAuthLoginResult(
    result: TuiOAuthResult,
    options?: { onProvisionStatus?: ((status: TuiDextoApiKeyProvisionStatus) => void) | undefined }
): Promise<TuiPersistedLoginResult> {
    if (!runtimeServices.persistOAuthLoginResult) {
        throw missingHostMethod('persistOAuthLoginResult');
    }
    return runtimeServices.persistOAuthLoginResult(result, options);
}

export async function ensureDextoApiKeyForAuthToken(
    authToken: string,
    options?: { onStatus?: ((status: TuiDextoApiKeyProvisionStatus) => void) | undefined }
): Promise<{ dextoApiKey: string; keyId: string | null } | null> {
    if (!runtimeServices.ensureDextoApiKeyForAuthToken) {
        throw missingHostMethod('ensureDextoApiKeyForAuthToken');
    }
    return runtimeServices.ensureDextoApiKeyForAuthToken(authToken, options);
}

export async function loadAuth(): Promise<TuiAuthConfig | null> {
    if (!runtimeServices.loadAuth) {
        throw missingHostMethod('loadAuth');
    }
    return runtimeServices.loadAuth();
}

export async function storeAuth(config: TuiAuthConfig): Promise<void> {
    if (!runtimeServices.storeAuth) {
        throw missingHostMethod('storeAuth');
    }
    await runtimeServices.storeAuth(config);
}

export async function removeAuth(): Promise<void> {
    if (!runtimeServices.removeAuth) {
        throw missingHostMethod('removeAuth');
    }
    await runtimeServices.removeAuth();
}

export async function removeDextoApiKeyFromEnv(options?: {
    expectedValue?: string;
}): Promise<{ removed: boolean; targetEnvPath: string }> {
    if (!runtimeServices.removeDextoApiKeyFromEnv) {
        throw missingHostMethod('removeDextoApiKeyFromEnv');
    }
    return runtimeServices.removeDextoApiKeyFromEnv(options);
}

export async function isUsingDextoCredits(): Promise<boolean> {
    if (!runtimeServices.isUsingDextoCredits) {
        throw missingHostMethod('isUsingDextoCredits');
    }
    return runtimeServices.isUsingDextoCredits();
}

export async function canUseDextoProvider(): Promise<boolean> {
    if (!runtimeServices.canUseDextoProvider) {
        throw missingHostMethod('canUseDextoProvider');
    }
    return runtimeServices.canUseDextoProvider();
}

export function buildDextoBillingUrl(options: { creditsUsd: number }): string {
    if (!runtimeServices.buildDextoBillingUrl) {
        throw missingHostMethod('buildDextoBillingUrl');
    }
    return runtimeServices.buildDextoBillingUrl(options);
}

export async function openDextoBillingPage(options: { url?: string | undefined }): Promise<void> {
    if (!runtimeServices.openDextoBillingPage) {
        throw missingHostMethod('openDextoBillingPage');
    }
    return runtimeServices.openDextoBillingPage(options);
}
