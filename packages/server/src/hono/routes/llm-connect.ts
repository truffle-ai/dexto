import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
    CONNECT_PROVIDERS,
    ConnectProviderSchema,
    loadLlmAuthProfilesStore,
    deleteLlmAuthProfile,
    setDefaultLlmAuthProfile,
} from '@dexto/agent-management';

const ProfileRedactedSchema = z
    .object({
        profileId: z.string(),
        providerId: z.string(),
        methodId: z.string(),
        label: z.string().optional(),
        credentialType: z.enum(['api_key', 'token', 'oauth']),
        createdAt: z.number(),
        updatedAt: z.number(),
        expiresAt: z.number().optional(),
    })
    .strict();

const ProvidersResponseSchema = z
    .object({
        providers: z.array(ConnectProviderSchema).describe('Curated connect providers'),
    })
    .strict();

const ProfilesResponseSchema = z
    .object({
        defaults: z.record(z.string(), z.string()).describe('providerId -> default profileId'),
        profiles: z.array(ProfileRedactedSchema).describe('Saved profiles (redacted)'),
    })
    .strict();

const DeleteProfileParamsSchema = z
    .object({
        profileId: z.string().describe('Profile id to delete'),
    })
    .strict();

const SetDefaultBodySchema = z
    .object({
        providerId: z.string().describe('Provider id'),
        profileId: z
            .string()
            .nullable()
            .describe('Profile id to set as default (null clears the default)'),
    })
    .strict();

export function createLlmConnectRouter() {
    const app = new OpenAPIHono();

    const providersRoute = createRoute({
        method: 'get',
        path: '/llm/connect/providers',
        summary: 'Connect Providers',
        description: 'Lists curated providers and supported login methods for /connect.',
        tags: ['llm'],
        responses: {
            200: {
                description: 'Provider/method catalog',
                content: { 'application/json': { schema: ProvidersResponseSchema } },
            },
        },
    });

    const profilesRoute = createRoute({
        method: 'get',
        path: '/llm/connect/profiles',
        summary: 'Connect Profiles',
        description: 'Lists saved provider auth profiles (redacted) and per-provider defaults.',
        tags: ['llm'],
        responses: {
            200: {
                description: 'Profiles + defaults',
                content: { 'application/json': { schema: ProfilesResponseSchema } },
            },
        },
    });

    const deleteProfileRoute = createRoute({
        method: 'delete',
        path: '/llm/connect/profiles/{profileId}',
        summary: 'Delete Connect Profile',
        description: 'Deletes a saved profile and clears defaults that reference it.',
        tags: ['llm'],
        request: { params: DeleteProfileParamsSchema },
        responses: {
            200: {
                description: 'Delete result',
                content: {
                    'application/json': {
                        schema: z
                            .object({ ok: z.boolean() })
                            .strict()
                            .describe('Delete profile response'),
                    },
                },
            },
        },
    });

    const setDefaultRoute = createRoute({
        method: 'post',
        path: '/llm/connect/defaults',
        summary: 'Set Default Profile',
        description: 'Sets the default profile for a provider (or clears it).',
        tags: ['llm'],
        request: { body: { content: { 'application/json': { schema: SetDefaultBodySchema } } } },
        responses: {
            200: {
                description: 'Default updated',
                content: {
                    'application/json': {
                        schema: z.object({ ok: z.literal(true) }).strict(),
                    },
                },
            },
        },
    });

    return app
        .openapi(providersRoute, (ctx) => {
            return ctx.json({ providers: CONNECT_PROVIDERS });
        })
        .openapi(profilesRoute, async (ctx) => {
            const store = await loadLlmAuthProfilesStore();
            const profiles = Object.values(store.profiles).map((p) => ({
                profileId: p.profileId,
                providerId: p.providerId,
                methodId: p.methodId,
                ...(p.label ? { label: p.label } : {}),
                credentialType: p.credential.type,
                createdAt: p.createdAt,
                updatedAt: p.updatedAt,
                ...(p.credential.type === 'oauth' ? { expiresAt: p.credential.expiresAt } : {}),
                ...(p.credential.type === 'token' && p.credential.expiresAt
                    ? { expiresAt: p.credential.expiresAt }
                    : {}),
            }));

            return ctx.json({ defaults: store.defaults, profiles });
        })
        .openapi(deleteProfileRoute, async (ctx) => {
            const { profileId } = ctx.req.valid('param');
            const ok = await deleteLlmAuthProfile(profileId);
            return ctx.json({ ok });
        })
        .openapi(setDefaultRoute, async (ctx) => {
            const { providerId, profileId } = ctx.req.valid('json');
            await setDefaultLlmAuthProfile({ providerId, profileId });
            return ctx.json({ ok: true as const });
        });
}
