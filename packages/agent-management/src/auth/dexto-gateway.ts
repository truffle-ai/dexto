// Dexto models (`dexto-nova`) on the sign-in: each gateway request carries the signed-in person's
// token, refreshed when it has to be, and the Cloud project it bills.

import { getDextoGlobalPath, type LlmRuntimeAuthOverrides } from '@dexto/core';
import { z } from 'zod';
import { type Credential, type OAuthLogin, resolveCredential } from './dexto-accounts.js';
import { refreshSignIn } from './dexto-sign-in.js';

const DEXTO_CLOUD_PROJECT_HEADER = 'Dexto-Cloud-Project';
/** Satisfies the provider's "has a key" check; every request's real token is set per call. */
const SIGN_IN_PLACEHOLDER_KEY = 'dexto-sign-in';

export interface DextoGatewayOptions {
    /** ~/.dexto/accounts */
    readonly dir: string;
    readonly environment: Readonly<Record<string, string | undefined>>;
    /** The public API new sign-ins use; requests go to the one their sign-in was saved for. */
    readonly apiBaseUrl: string;
    readonly fetch: typeof globalThis.fetch;
    readonly refresh: (login: OAuthLogin) => Promise<OAuthLogin>;
}

/** This machine's sign-in, Dexto's public API and the global fetch. */
export function defaultDextoGatewayOptions(): DextoGatewayOptions {
    const fetch = globalThis.fetch;
    return {
        dir: getDextoGlobalPath('accounts'),
        environment: process.env,
        apiBaseUrl: (process.env.DEXTO_PUBLIC_API_URL || 'https://api.dexto.ai').replace(
            /\/+$/u,
            ''
        ),
        fetch,
        refresh: (login) => refreshSignIn({ fetch, signal: AbortSignal.timeout(10_000) }, login),
    };
}

/** Whether Dexto models can be used now, and if not, what's missing. */
export type DextoModelAccess =
    | { readonly status: 'ready' }
    | { readonly status: 'signed_out' }
    | { readonly status: 'needs_scope' }
    | { readonly status: 'needs_project' };

export async function dextoModelAccess(options: DextoGatewayOptions): Promise<DextoModelAccess> {
    if (nonEmpty(options.environment.DEXTO_API_KEY)) return { status: 'ready' };
    const credential = await currentCredential(options);
    if (credential === null) return { status: 'signed_out' };
    if (credential.kind === 'api_key') return { status: 'ready' };
    if (!canSpend(credential.login)) return { status: 'needs_scope' };
    if (credential.login.cloudProject === null) return { status: 'needs_project' };
    return { status: 'ready' };
}

/**
 * The runtime auth for `dexto-nova` when DEXTO_API_KEY isn't set: the public API's gateway, with a
 * fetch that signs each request as the current profile. Null leaves DEXTO_API_KEY to the key path.
 */
export function dextoGatewayRuntimeAuth(
    options: DextoGatewayOptions
): LlmRuntimeAuthOverrides | null {
    if (nonEmpty(options.environment.DEXTO_API_KEY)) return null;
    return {
        apiKey: SIGN_IN_PLACEHOLDER_KEY,
        baseURL: `${options.apiBaseUrl}/v1`,
        fetch: async (input, init) => {
            const credential = await currentCredential(options);
            const headers = new globalThis.Headers(init?.headers);
            if (credential === null)
                throw new Error(
                    'Dexto models need a Dexto sign-in. Run dexto login, or choose another provider.'
                );
            const apiBaseUrl =
                credential.kind === 'oauth' ? credential.login.apiBaseUrl : options.apiBaseUrl;
            if (credential.kind === 'oauth') {
                if (!canSpend(credential.login))
                    throw new Error(
                        'Dexto models spend credits, which this sign-in may not do yet. Run dexto login --scope cloud:write.'
                    );
                if (credential.login.cloudProject === null)
                    throw new Error(
                        'Your organization has no Cloud project for Dexto models to bill. Create one in Dexto, then run dexto login again.'
                    );
                headers.set(DEXTO_CLOUD_PROJECT_HEADER, credential.login.cloudProject.id);
            }
            headers.set('authorization', `Bearer ${credential.token}`);
            return await options.fetch(rebase(String(input), options.apiBaseUrl, apiBaseUrl), {
                ...init,
                headers,
            });
        },
    };
}

/** A model Dexto serves, by the id to send as `model`. */
export interface DextoModel {
    readonly id: string;
    readonly name: string;
    readonly contextWindow: number;
}

const ModelListSchema = z.object({
    data: z.array(z.object({ id: z.string(), name: z.string(), context_window: z.number() })),
});

const BillingSummarySchema = z.object({
    balance_usd: z.number(),
    last_30_days: z.object({ total_cost_usd: z.number(), total_usage_events: z.number() }),
    recent_model_usage: z.array(
        z.object({ model: z.string(), cost_usd: z.number(), timestamp: z.string() })
    ),
});

/** The organization's credits and what was spent, as the caller may see it. */
export interface DextoBillingSummary {
    readonly balanceUsd: number;
    readonly last30Days: { readonly costUsd: number; readonly usageEvents: number };
    readonly recent: readonly {
        readonly model: string;
        readonly costUsd: number;
        readonly timestamp: string;
    }[];
}

/** The models Dexto serves: `GET /v1/models`. Null when signed out. */
export async function dextoModels(options: DextoGatewayOptions): Promise<DextoModel[] | null> {
    const body = await readDexto(options, '/v1/models');
    if (body === null) return null;
    return ModelListSchema.parse(body).data.map((model) => ({
        id: model.id,
        name: model.name,
        contextWindow: model.context_window,
    }));
}

/** The organization's credits and recent spending: `GET /v1/billing/summary`. Null when signed out. */
export async function dextoBillingSummary(
    options: DextoGatewayOptions
): Promise<DextoBillingSummary | null> {
    const body = await readDexto(options, '/v1/billing/summary');
    if (body === null) return null;
    const summary = BillingSummarySchema.parse(body);
    return {
        balanceUsd: summary.balance_usd,
        last30Days: {
            costUsd: summary.last_30_days.total_cost_usd,
            usageEvents: summary.last_30_days.total_usage_events,
        },
        recent: summary.recent_model_usage.map((usage) => ({
            model: usage.model,
            costUsd: usage.cost_usd,
            timestamp: usage.timestamp,
        })),
    };
}

/** Reads a public `/v1` path as the current sign-in or DEXTO_API_KEY; null when signed out. */
async function readDexto(options: DextoGatewayOptions, path: string): Promise<unknown> {
    const credential = await currentCredential(options);
    if (credential === null) return null;
    const apiBaseUrl =
        credential.kind === 'oauth' ? credential.login.apiBaseUrl : options.apiBaseUrl;
    const response = await options.fetch(`${apiBaseUrl}${path}`, {
        headers: { accept: 'application/json', authorization: `Bearer ${credential.token}` },
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Dexto answered ${path} with HTTP ${response.status}.`);
    return await response.json();
}

/** The current profile's credential, refreshed when expiring; null when signed out. */
export async function currentCredential(options: DextoGatewayOptions): Promise<Credential | null> {
    return await resolveCredential({
        dir: options.dir,
        apiKey: null,
        profile: null,
        environment: options.environment,
        refresh: options.refresh,
    });
}

function canSpend(login: OAuthLogin): boolean {
    return login.scopes.includes('cloud:write');
}

/** The same path on the API the sign-in was saved for. */
function rebase(url: string, from: string, to: string): string {
    return from === to || !url.startsWith(from) ? url : `${to}${url.slice(from.length)}`;
}

function nonEmpty(value: string | undefined): boolean {
    return value !== undefined && value.trim().length > 0;
}
