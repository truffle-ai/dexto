import type { LLMProvider } from '@dexto/llm';
import type { TuiAgentBackend } from '../agent-backend.js';

export interface TuiShutdownHandle {
    stop?: (() => Promise<void>) | undefined;
}

export interface TuiSignInOptions {
    /** Aborts the sign-in, such as when the person presses Esc. */
    signal: AbortSignal;
    /** What to show while signing in: the link, or the code to check. */
    onNote: (text: string) => void;
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
    /** Who the current profile acts as, in a few words, or null when signed out. */
    currentSignIn?: () => Promise<string | null>;
    /** Signs the current profile in to Dexto, resolving with what to say once signed in. */
    signIn?: (options: TuiSignInOptions) => Promise<string>;
    /** Ends the current profile's sign-in, resolving with what to say. */
    signOut?: () => Promise<string>;
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

export async function currentSignIn(): Promise<string | null> {
    if (!runtimeServices.currentSignIn) {
        throw missingHostMethod('currentSignIn');
    }
    return runtimeServices.currentSignIn();
}

export async function signIn(options: TuiSignInOptions): Promise<string> {
    if (!runtimeServices.signIn) {
        throw missingHostMethod('signIn');
    }
    return runtimeServices.signIn(options);
}

export async function signOut(): Promise<string> {
    if (!runtimeServices.signOut) {
        throw missingHostMethod('signOut');
    }
    return runtimeServices.signOut();
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
