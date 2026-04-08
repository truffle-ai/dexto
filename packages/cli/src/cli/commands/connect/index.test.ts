import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleConnectCommand } from './index.js';
import type { LlmAuthProfile } from '@dexto/agent-management';

const codexLoginMocks = vi.hoisted(() => ({
    createCodexClientForChatGptLogin: vi.fn(),
    ensureCodexChatGptSession: vi.fn(),
    getCodexLoginErrorMessage: vi.fn((error: unknown) =>
        error instanceof Error ? error.message : String(error)
    ),
}));

vi.mock('open', () => ({ default: vi.fn() }));

vi.mock('@clack/prompts', () => ({
    intro: vi.fn(),
    outro: vi.fn(),
    cancel: vi.fn(),
    select: vi.fn(),
    password: vi.fn(),
    confirm: vi.fn(),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
    isCancel: vi.fn(() => false),
    log: { warn: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@dexto/agent-management', () => {
    const PROVIDER_AUTH_DEFINITIONS = [
        {
            providerId: 'openai',
            label: 'OpenAI',
            methods: [
                {
                    id: 'chatgpt_login',
                    label: 'ChatGPT Login',
                    kind: 'external_account',
                    externalAccount: { resolveRuntimeAuth: vi.fn() },
                },
                { id: 'api_key', label: 'API key', kind: 'api_key' },
            ],
        },
        {
            providerId: 'anthropic',
            label: 'Anthropic',
            methods: [
                { id: 'setup_token', label: 'Setup token', kind: 'token' },
                { id: 'api_key', label: 'API key', kind: 'api_key' },
            ],
        },
        {
            providerId: 'minimax',
            label: 'MiniMax',
            methods: [
                {
                    id: 'portal_oauth_global',
                    label: 'MiniMax Portal OAuth',
                    kind: 'oauth',
                    oauth: {
                        start: vi.fn(),
                        refresh: vi.fn(),
                        resolveRuntimeAuth: vi.fn(),
                    },
                },
            ],
        },
    ];

    return {
        PROVIDER_AUTH_DEFINITIONS,
        getProviderAuthDefinition: vi.fn((providerId: string) => {
            return (
                PROVIDER_AUTH_DEFINITIONS.find((provider) => provider.providerId === providerId) ??
                null
            );
        }),
        listLlmAuthProfiles: vi.fn(),
        getDefaultLlmAuthProfileId: vi.fn(),
        setDefaultLlmAuthProfile: vi.fn(),
        upsertLlmAuthProfile: vi.fn(),
        deleteLlmAuthProfile: vi.fn(),
    };
});

vi.mock('../../utils/codex-chatgpt-login.js', () => codexLoginMocks);

function makeProfile(params: {
    profileId: string;
    providerId: string;
    methodId: string;
}): LlmAuthProfile {
    return {
        profileId: params.profileId,
        providerId: params.providerId,
        methodId: params.methodId,
        label: 'Test label',
        credential: { type: 'api_key', key: 'sk-test-123' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
}

describe('/connect command (auth slots)', () => {
    beforeEach(async () => {
        vi.clearAllMocks();

        const prompts = await import('@clack/prompts');
        vi.mocked(prompts.isCancel).mockReturnValue(false);
    });

    it('creates a new api_key slot and sets default', async () => {
        const prompts = await import('@clack/prompts');
        const agentManagement = await import('@dexto/agent-management');

        vi.mocked(prompts.select).mockResolvedValueOnce('openai').mockResolvedValueOnce('api_key');
        vi.mocked(prompts.password).mockResolvedValueOnce('sk-live-1234567890');

        vi.mocked(agentManagement.listLlmAuthProfiles).mockResolvedValueOnce([]);
        vi.mocked(agentManagement.getDefaultLlmAuthProfileId).mockResolvedValueOnce(null);

        await handleConnectCommand({ interactive: true });

        expect(agentManagement.upsertLlmAuthProfile).toHaveBeenCalledWith(
            expect.objectContaining({
                profileId: 'openai:api_key',
                providerId: 'openai',
                methodId: 'api_key',
                credential: { type: 'api_key', key: 'sk-live-1234567890' },
            })
        );
        expect(agentManagement.setDefaultLlmAuthProfile).toHaveBeenCalledWith({
            providerId: 'openai',
            profileId: 'openai:api_key',
        });
    });

    it('uses existing slot (no re-auth) and sets default', async () => {
        const prompts = await import('@clack/prompts');
        const agentManagement = await import('@dexto/agent-management');

        vi.mocked(prompts.select)
            .mockResolvedValueOnce('openai') // provider
            .mockResolvedValueOnce('api_key') // method
            .mockResolvedValueOnce('use_existing'); // action

        vi.mocked(agentManagement.listLlmAuthProfiles).mockResolvedValueOnce([
            makeProfile({ profileId: 'openai:api_key', providerId: 'openai', methodId: 'api_key' }),
        ]);
        vi.mocked(agentManagement.getDefaultLlmAuthProfileId).mockResolvedValueOnce(null);

        await handleConnectCommand({ interactive: true });

        expect(agentManagement.setDefaultLlmAuthProfile).toHaveBeenCalledWith({
            providerId: 'openai',
            profileId: 'openai:api_key',
        });
        expect(agentManagement.upsertLlmAuthProfile).not.toHaveBeenCalled();
        expect(prompts.password).not.toHaveBeenCalled();
    });

    it('replaces an existing slot when requested', async () => {
        const prompts = await import('@clack/prompts');
        const agentManagement = await import('@dexto/agent-management');

        vi.mocked(prompts.select)
            .mockResolvedValueOnce('openai') // provider
            .mockResolvedValueOnce('api_key') // method
            .mockResolvedValueOnce('replace'); // action
        vi.mocked(prompts.password).mockResolvedValueOnce('sk-new-1234567890');

        vi.mocked(agentManagement.listLlmAuthProfiles).mockResolvedValueOnce([
            makeProfile({ profileId: 'openai:api_key', providerId: 'openai', methodId: 'api_key' }),
        ]);
        vi.mocked(agentManagement.getDefaultLlmAuthProfileId).mockResolvedValueOnce(
            'openai:api_key'
        );

        await handleConnectCommand({ interactive: true });

        expect(agentManagement.upsertLlmAuthProfile).toHaveBeenCalledWith(
            expect.objectContaining({
                profileId: 'openai:api_key',
                credential: { type: 'api_key', key: 'sk-new-1234567890' },
            })
        );
    });

    it('deletes an existing slot when requested', async () => {
        const prompts = await import('@clack/prompts');
        const agentManagement = await import('@dexto/agent-management');

        vi.mocked(prompts.select)
            .mockResolvedValueOnce('openai') // provider
            .mockResolvedValueOnce('api_key') // method
            .mockResolvedValueOnce('delete'); // action
        vi.mocked(prompts.confirm).mockResolvedValueOnce(true);

        vi.mocked(agentManagement.listLlmAuthProfiles).mockResolvedValueOnce([
            makeProfile({ profileId: 'openai:api_key', providerId: 'openai', methodId: 'api_key' }),
        ]);
        vi.mocked(agentManagement.getDefaultLlmAuthProfileId).mockResolvedValueOnce(null);

        await handleConnectCommand({ interactive: true });

        expect(agentManagement.deleteLlmAuthProfile).toHaveBeenCalledWith('openai:api_key');
        expect(agentManagement.upsertLlmAuthProfile).not.toHaveBeenCalled();
    });

    it('selects a non-default method from the provider auth definition surface', async () => {
        const prompts = await import('@clack/prompts');
        const agentManagement = await import('@dexto/agent-management');

        vi.mocked(prompts.select)
            .mockResolvedValueOnce('anthropic')
            .mockResolvedValueOnce('setup_token');
        vi.mocked(prompts.password).mockResolvedValueOnce('anthropic-token-1234567890');

        vi.mocked(agentManagement.listLlmAuthProfiles).mockResolvedValueOnce([]);
        vi.mocked(agentManagement.getDefaultLlmAuthProfileId).mockResolvedValueOnce(null);

        await handleConnectCommand({ interactive: true });

        expect(agentManagement.upsertLlmAuthProfile).toHaveBeenCalledWith(
            expect.objectContaining({
                profileId: 'anthropic:setup_token',
                providerId: 'anthropic',
                methodId: 'setup_token',
                credential: { type: 'token', token: 'anthropic-token-1234567890' },
            })
        );
        expect(agentManagement.setDefaultLlmAuthProfile).toHaveBeenCalledWith({
            providerId: 'anthropic',
            profileId: 'anthropic:setup_token',
        });
    });

    it('persists ChatGPT Login as an external account credential', async () => {
        const prompts = await import('@clack/prompts');
        const agentManagement = await import('@dexto/agent-management');

        const close = vi.fn().mockResolvedValue(undefined);
        const client = { close };
        codexLoginMocks.createCodexClientForChatGptLogin.mockResolvedValueOnce(client);
        codexLoginMocks.ensureCodexChatGptSession.mockResolvedValueOnce({
            account: {
                type: 'chatgpt',
                email: 'user@example.com',
                planType: 'plus',
            },
            requiresOpenaiAuth: false,
        });

        vi.mocked(prompts.select)
            .mockResolvedValueOnce('openai')
            .mockResolvedValueOnce('chatgpt_login');
        vi.mocked(agentManagement.listLlmAuthProfiles).mockResolvedValueOnce([]);
        vi.mocked(agentManagement.getDefaultLlmAuthProfileId).mockResolvedValueOnce(null);

        await handleConnectCommand({ interactive: true });

        expect(agentManagement.upsertLlmAuthProfile).toHaveBeenCalledWith(
            expect.objectContaining({
                profileId: 'openai:chatgpt_login',
                providerId: 'openai',
                methodId: 'chatgpt_login',
                credential: {
                    type: 'external_account',
                    system: 'codex',
                    authMode: 'chatgpt',
                    metadata: {
                        email: 'user@example.com',
                        planType: 'plus',
                    },
                },
            })
        );
        expect(agentManagement.setDefaultLlmAuthProfile).toHaveBeenCalledWith({
            providerId: 'openai',
            profileId: 'openai:chatgpt_login',
        });
        expect(close).toHaveBeenCalled();
    });

    it('persists oauth credentials returned by the shared auth definition hooks', async () => {
        const prompts = await import('@clack/prompts');
        const agentManagement = await import('@dexto/agent-management');
        const openBrowser = await import('open');

        const waitForCompletion = vi.fn().mockResolvedValue({
            credential: {
                type: 'oauth',
                accessToken: 'access-token',
                refreshToken: 'refresh-token',
                expiresAt: Date.now() + 60_000,
                metadata: { clientId: 'client-id', region: 'global' },
            },
            notificationMessage: 'Connected via portal',
        });

        vi.mocked(prompts.select).mockResolvedValueOnce('minimax');
        vi.mocked(agentManagement.listLlmAuthProfiles).mockResolvedValueOnce([]);
        vi.mocked(agentManagement.getDefaultLlmAuthProfileId).mockResolvedValueOnce(null);
        vi.mocked(agentManagement.getProviderAuthDefinition).mockReturnValueOnce({
            providerId: 'minimax',
            label: 'MiniMax',
            methods: [
                {
                    id: 'portal_oauth_global',
                    label: 'MiniMax Portal OAuth',
                    kind: 'oauth',
                    oauth: {
                        start: vi.fn().mockResolvedValue({
                            verificationUrl: 'https://example.com/verify',
                            userCode: 'USER-CODE',
                            waitForCompletion,
                        }),
                        refresh: vi.fn(),
                        resolveRuntimeAuth: vi.fn(),
                    },
                },
            ],
        });

        await handleConnectCommand({ interactive: true });

        expect(openBrowser.default).toHaveBeenCalledWith('https://example.com/verify');
        expect(waitForCompletion).toHaveBeenCalledWith({
            onProgress: expect.any(Function),
        });
        expect(agentManagement.upsertLlmAuthProfile).toHaveBeenCalledWith(
            expect.objectContaining({
                profileId: 'minimax:portal_oauth_global',
                providerId: 'minimax',
                methodId: 'portal_oauth_global',
                credential: expect.objectContaining({
                    type: 'oauth',
                    accessToken: 'access-token',
                    refreshToken: 'refresh-token',
                }),
            })
        );
        expect(agentManagement.setDefaultLlmAuthProfile).toHaveBeenCalledWith({
            providerId: 'minimax',
            profileId: 'minimax:portal_oauth_global',
        });
    });
});
