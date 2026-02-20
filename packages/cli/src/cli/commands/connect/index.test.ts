import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleConnectCommand } from './index.js';
import type { LlmAuthProfile } from '@dexto/agent-management';

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
    const CONNECT_PROVIDERS = [
        {
            providerId: 'openai',
            label: 'OpenAI',
            methods: [{ id: 'api_key', label: 'API key', kind: 'api_key' }],
        },
    ];

    return {
        CONNECT_PROVIDERS,
        getConnectProvider: vi.fn((providerId: string) => {
            return CONNECT_PROVIDERS.find((p) => p.providerId === providerId) ?? null;
        }),
        listLlmAuthProfiles: vi.fn(),
        getDefaultLlmAuthProfileId: vi.fn(),
        setDefaultLlmAuthProfile: vi.fn(),
        upsertLlmAuthProfile: vi.fn(),
        deleteLlmAuthProfile: vi.fn(),
    };
});

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

        vi.mocked(prompts.select).mockResolvedValueOnce('openai');
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
});
