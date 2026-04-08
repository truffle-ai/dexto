import { z } from 'zod';

import {
    AUTH_METHOD_KINDS,
    PROVIDER_AUTH_DEFINITIONS,
    getProviderAuthDefinition,
    type AuthMethodDefinition,
    type ProviderAuthDefinition,
} from './provider-auth-definitions.js';

export const ConnectMethodKindSchema = z.enum(AUTH_METHOD_KINDS);
export type ConnectMethodKind = z.output<typeof ConnectMethodKindSchema>;

export const ConnectMethodSchema = z
    .object({
        id: z.string().min(1),
        label: z.string().min(1),
        kind: ConnectMethodKindSchema,
        hint: z.string().optional(),
    })
    .strict();
export type ConnectMethod = z.output<typeof ConnectMethodSchema>;

export const ConnectProviderSchema = z
    .object({
        providerId: z.string().min(1),
        label: z.string().min(1),
        /**
         * Optional models.dev provider id for linking metadata (api base URL, docs, env vars).
         * This is not required to match Dexto's internal provider id.
         */
        modelsDevProviderId: z.string().min(1).optional(),
        methods: z.array(ConnectMethodSchema).min(1),
    })
    .strict();
export type ConnectProvider = z.output<typeof ConnectProviderSchema>;

function toConnectMethod(method: AuthMethodDefinition): ConnectMethod {
    return ConnectMethodSchema.parse({
        id: method.id,
        label: method.label,
        kind: method.kind,
        ...(method.hint ? { hint: method.hint } : {}),
    });
}

function toConnectProvider(provider: ProviderAuthDefinition): ConnectProvider {
    return ConnectProviderSchema.parse({
        providerId: provider.providerId,
        label: provider.label,
        ...(provider.modelsDevProviderId
            ? { modelsDevProviderId: provider.modelsDevProviderId }
            : {}),
        methods: provider.methods.map(toConnectMethod),
    });
}

export const CONNECT_PROVIDERS: ConnectProvider[] =
    PROVIDER_AUTH_DEFINITIONS.map(toConnectProvider);

export function getConnectProvider(providerId: string): ConnectProvider | null {
    const provider = getProviderAuthDefinition(providerId);
    return provider ? toConnectProvider(provider) : null;
}
