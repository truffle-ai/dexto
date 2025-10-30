import type { PromptInfo } from '@dexto/core';
import { getApiUrl } from './api-url';

let cachedPrompts: PromptInfo[] | null = null;
let pendingRequest: Promise<PromptInfo[]> | null = null;

async function fetchPrompts(): Promise<PromptInfo[]> {
    const response = await fetch(`${getApiUrl()}/api/prompts`);
    if (!response.ok) {
        const message = await response.text().catch(() => '');
        throw new Error(
            message ? `HTTP ${response.status}: ${message}` : `HTTP ${response.status}`
        );
    }
    const body = await response.json();
    if (!body || !Array.isArray(body.prompts)) {
        throw new Error('Invalid prompt response shape');
    }
    return body.prompts as PromptInfo[];
}

export async function loadPrompts(options?: { forceRefresh?: boolean }): Promise<PromptInfo[]> {
    if (options?.forceRefresh) {
        cachedPrompts = null;
    }

    if (cachedPrompts) {
        return cachedPrompts;
    }

    if (!pendingRequest) {
        pendingRequest = fetchPrompts()
            .then((prompts) => {
                cachedPrompts = prompts;
                return prompts;
            })
            .finally(() => {
                pendingRequest = null;
            });
    }

    return pendingRequest;
}

export function clearPromptCache(): void {
    cachedPrompts = null;
    pendingRequest = null;
}
