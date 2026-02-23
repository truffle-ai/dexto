import { z } from 'zod';

export const ConnectMethodKindSchema = z.enum(['api_key', 'token', 'oauth', 'guidance']);
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

/**
 * Curated catalog of providers and auth methods for `/connect`.
 *
 * Notes:
 * - This is intentionally small in v1. We'll expand via models.dev provider metadata after
 *   we have stable runtime transport mappings.
 * - Provider IDs here are "connect surface" IDs; they may map to existing LLM providers,
 *   presets, or future first-class providers.
 */
export const CONNECT_PROVIDERS: ConnectProvider[] = [
    {
        providerId: 'openai',
        label: 'OpenAI',
        modelsDevProviderId: 'openai',
        methods: [
            { id: 'oauth_codex', label: 'ChatGPT Pro/Plus (OAuth)', kind: 'oauth' },
            { id: 'api_key', label: 'API key', kind: 'api_key' },
        ],
    },
    {
        providerId: 'anthropic',
        label: 'Anthropic',
        modelsDevProviderId: 'anthropic',
        methods: [
            { id: 'setup_token', label: 'Setup token (subscription)', kind: 'token' },
            { id: 'api_key', label: 'API key', kind: 'api_key' },
        ],
    },
    {
        providerId: 'minimax',
        label: 'MiniMax',
        modelsDevProviderId: 'minimax',
        methods: [
            { id: 'portal_oauth_global', label: 'MiniMax Portal OAuth (Global)', kind: 'oauth' },
            { id: 'portal_oauth_cn', label: 'MiniMax Portal OAuth (CN)', kind: 'oauth' },
            { id: 'api_key', label: 'API key', kind: 'api_key' },
        ],
    },
    {
        providerId: 'minimax-cn',
        label: 'MiniMax (CN)',
        modelsDevProviderId: 'minimax-cn',
        methods: [
            { id: 'portal_oauth_cn', label: 'MiniMax Portal OAuth (CN)', kind: 'oauth' },
            { id: 'api_key', label: 'API key', kind: 'api_key' },
        ],
    },
    {
        providerId: 'minimax-coding-plan',
        label: 'MiniMax Coding Plan',
        modelsDevProviderId: 'minimax-coding-plan',
        methods: [
            { id: 'portal_oauth_global', label: 'MiniMax Portal OAuth (Global)', kind: 'oauth' },
            { id: 'portal_oauth_cn', label: 'MiniMax Portal OAuth (CN)', kind: 'oauth' },
            { id: 'api_key', label: 'API key', kind: 'api_key' },
        ],
    },
    {
        providerId: 'minimax-cn-coding-plan',
        label: 'MiniMax Coding Plan (CN)',
        modelsDevProviderId: 'minimax-cn-coding-plan',
        methods: [
            { id: 'portal_oauth_cn', label: 'MiniMax Portal OAuth (CN)', kind: 'oauth' },
            { id: 'api_key', label: 'API key', kind: 'api_key' },
        ],
    },
    {
        providerId: 'moonshotai',
        label: 'Moonshot AI (Kimi)',
        modelsDevProviderId: 'moonshotai',
        methods: [{ id: 'api_key', label: 'API key', kind: 'api_key' }],
    },
    {
        providerId: 'moonshotai-cn',
        label: 'Moonshot AI (Kimi) (China)',
        modelsDevProviderId: 'moonshotai-cn',
        methods: [{ id: 'api_key', label: 'API key', kind: 'api_key' }],
    },
    {
        providerId: 'zhipuai',
        label: 'Zhipu AI (GLM)',
        modelsDevProviderId: 'zhipuai',
        methods: [{ id: 'api_key', label: 'API key', kind: 'api_key' }],
    },
    {
        providerId: 'zhipuai-coding-plan',
        label: 'Zhipu AI Coding Plan',
        modelsDevProviderId: 'zhipuai-coding-plan',
        methods: [{ id: 'api_key', label: 'API key', kind: 'api_key' }],
    },
    {
        providerId: 'zai',
        label: 'Z.AI',
        modelsDevProviderId: 'zai',
        methods: [{ id: 'api_key', label: 'API key', kind: 'api_key' }],
    },
    {
        providerId: 'zai-coding-plan',
        label: 'Z.AI Coding Plan',
        modelsDevProviderId: 'zai-coding-plan',
        methods: [{ id: 'api_key', label: 'API key', kind: 'api_key' }],
    },
    {
        providerId: 'kimi-for-coding',
        label: 'Kimi For Coding',
        modelsDevProviderId: 'kimi-for-coding',
        methods: [{ id: 'api_key', label: 'API key', kind: 'api_key' }],
    },
    {
        providerId: 'openrouter',
        label: 'OpenRouter',
        modelsDevProviderId: 'openrouter',
        methods: [{ id: 'api_key', label: 'API key', kind: 'api_key' }],
    },
    {
        providerId: 'litellm',
        label: 'LiteLLM',
        modelsDevProviderId: 'litellm',
        methods: [
            {
                id: 'guidance',
                label: 'Guided setup',
                kind: 'guidance',
                hint: 'Set base URL and API key for your LiteLLM proxy',
            },
        ],
    },
    {
        providerId: 'bedrock',
        label: 'Amazon Bedrock',
        modelsDevProviderId: 'amazon-bedrock',
        methods: [
            {
                id: 'guidance',
                label: 'Guided setup',
                kind: 'guidance',
                hint: 'Use AWS credential chain or AWS_BEARER_TOKEN_BEDROCK',
            },
        ],
    },
    {
        providerId: 'vertex',
        label: 'Google Vertex AI',
        modelsDevProviderId: 'google-vertex',
        methods: [
            {
                id: 'guidance',
                label: 'Guided setup',
                kind: 'guidance',
                hint: 'Use Application Default Credentials (gcloud auth application-default login)',
            },
        ],
    },
];

export function getConnectProvider(providerId: string): ConnectProvider | null {
    return CONNECT_PROVIDERS.find((p) => p.providerId === providerId) ?? null;
}
