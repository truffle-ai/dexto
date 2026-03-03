import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requiresSetup, isFirstTimeUser } from './setup-utils.js';

vi.mock('@dexto/agent-management', async () => {
    const actual =
        await vi.importActual<typeof import('@dexto/agent-management')>('@dexto/agent-management');
    return {
        ...actual,
        globalPreferencesExist: vi.fn(),
        loadGlobalPreferences: vi.fn(),
        getExecutionContext: vi.fn(),
    };
});

const { globalPreferencesExist, loadGlobalPreferences, getExecutionContext } = await import(
    '@dexto/agent-management'
);

describe('requiresSetup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('source context', () => {
        beforeEach(() => {
            vi.mocked(getExecutionContext).mockReturnValue('dexto-source');
        });

        it('skips setup checks for first-time user', async () => {
            vi.mocked(globalPreferencesExist).mockReturnValue(false);

            const result = await requiresSetup();

            expect(result).toBe(false);
            expect(globalPreferencesExist).not.toHaveBeenCalled();
            expect(loadGlobalPreferences).not.toHaveBeenCalled();
        });

        it('skips setup checks even with existing preferences', async () => {
            vi.mocked(globalPreferencesExist).mockReturnValue(true);

            const result = await requiresSetup();

            expect(result).toBe(false);
            expect(globalPreferencesExist).not.toHaveBeenCalled();
            expect(loadGlobalPreferences).not.toHaveBeenCalled();
        });
    });

    describe('project context', () => {
        beforeEach(() => {
            vi.mocked(getExecutionContext).mockReturnValue('dexto-project');
        });

        it('skips setup checks for first-time user', async () => {
            vi.mocked(globalPreferencesExist).mockReturnValue(false);

            const result = await requiresSetup();

            expect(result).toBe(false);
            expect(globalPreferencesExist).not.toHaveBeenCalled();
            expect(loadGlobalPreferences).not.toHaveBeenCalled();
        });

        it('skips setup checks with existing preferences', async () => {
            vi.mocked(globalPreferencesExist).mockReturnValue(true);

            const result = await requiresSetup();

            expect(result).toBe(false);
            expect(globalPreferencesExist).not.toHaveBeenCalled();
            expect(loadGlobalPreferences).not.toHaveBeenCalled();
        });
    });

    describe('global-cli context', () => {
        beforeEach(() => {
            vi.mocked(getExecutionContext).mockReturnValue('global-cli');
        });

        it('requires setup for first-time user', async () => {
            vi.mocked(globalPreferencesExist).mockReturnValue(false);

            const result = await requiresSetup();

            expect(result).toBe(true);
        });

        it('does not require setup with valid preferences', async () => {
            vi.mocked(globalPreferencesExist).mockReturnValue(true);
            vi.mocked(loadGlobalPreferences).mockResolvedValue({
                llm: {
                    provider: 'google',
                    model: 'gemini-2.5-pro',
                    apiKey: '$GOOGLE_GENERATIVE_AI_API_KEY',
                },
                defaults: {
                    defaultAgent: 'coding-agent',
                    defaultMode: 'web',
                },
                setup: {
                    completed: true,
                    apiKeyPending: false,
                    baseURLPending: false,
                },
                sounds: {
                    enabled: true,
                    onStartup: true,
                    onApprovalRequired: true,
                    onTaskComplete: true,
                },
            });

            const result = await requiresSetup();

            expect(result).toBe(false);
        });

        it('requires setup with incomplete setup flag', async () => {
            vi.mocked(globalPreferencesExist).mockReturnValue(true);
            vi.mocked(loadGlobalPreferences).mockResolvedValue({
                llm: {
                    provider: 'google',
                    model: 'gemini-2.5-pro',
                    apiKey: '$GOOGLE_GENERATIVE_AI_API_KEY',
                },
                defaults: {
                    defaultAgent: 'coding-agent',
                    defaultMode: 'web',
                },
                setup: {
                    completed: false,
                    apiKeyPending: false,
                    baseURLPending: false,
                },
                sounds: {
                    enabled: true,
                    onStartup: true,
                    onApprovalRequired: true,
                    onTaskComplete: true,
                },
            });

            const result = await requiresSetup();

            expect(result).toBe(true);
        });

        it('requires setup with missing defaultAgent', async () => {
            vi.mocked(globalPreferencesExist).mockReturnValue(true);
            vi.mocked(loadGlobalPreferences).mockResolvedValue({
                llm: {
                    provider: 'google',
                    model: 'gemini-2.5-pro',
                    apiKey: '$GOOGLE_GENERATIVE_AI_API_KEY',
                },
                defaults: {
                    defaultAgent: '',
                    defaultMode: 'web',
                },
                setup: {
                    completed: true,
                    apiKeyPending: false,
                    baseURLPending: false,
                },
                sounds: {
                    enabled: true,
                    onStartup: true,
                    onApprovalRequired: true,
                    onTaskComplete: true,
                },
            });

            const result = await requiresSetup();

            expect(result).toBe(true);
        });

        it('requires setup with corrupted preferences', async () => {
            vi.mocked(globalPreferencesExist).mockReturnValue(true);
            vi.mocked(loadGlobalPreferences).mockRejectedValue(new Error('Corrupted YAML'));

            const result = await requiresSetup();

            expect(result).toBe(true);
        });
    });
});

describe('isFirstTimeUser', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns true when preferences do not exist', () => {
        vi.mocked(globalPreferencesExist).mockReturnValue(false);

        const result = isFirstTimeUser();

        expect(result).toBe(true);
    });

    it('returns false when preferences exist', () => {
        vi.mocked(globalPreferencesExist).mockReturnValue(true);

        const result = isFirstTimeUser();

        expect(result).toBe(false);
    });
});
