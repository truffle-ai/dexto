import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { requiresSetup, isFirstTimeUser } from './setup-utils.js';

// Mock dependencies
vi.mock('@dexto/agent-management', async () => {
    const actual = await vi.importActual('@dexto/agent-management');
    return {
        ...actual,
        findDextoProjectRoot: vi.fn(),
        findProjectRegistryPathSync: vi.fn(),
        globalPreferencesExist: vi.fn(),
        loadGlobalPreferences: vi.fn(),
    };
});

vi.mock('@dexto/core', async () => {
    const actual = await vi.importActual('@dexto/core');
    return {
        ...actual,
        getExecutionContext: vi.fn(),
    };
});

const {
    findDextoProjectRoot,
    findProjectRegistryPathSync,
    globalPreferencesExist,
    loadGlobalPreferences,
} = await import('@dexto/agent-management');
const { getExecutionContext } = await import('@dexto/core');

describe('requiresSetup', () => {
    const originalEnv = process.env.DEXTO_DEV_MODE;

    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.DEXTO_DEV_MODE;
        vi.mocked(findDextoProjectRoot).mockReturnValue(null);
        vi.mocked(findProjectRegistryPathSync).mockReturnValue(null);
    });

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.DEXTO_DEV_MODE;
        } else {
            process.env.DEXTO_DEV_MODE = originalEnv;
        }
    });

    describe('Dev mode (DEXTO_DEV_MODE=true)', () => {
        beforeEach(() => {
            process.env.DEXTO_DEV_MODE = 'true';
        });

        it('should skip setup in source context', async () => {
            vi.mocked(getExecutionContext).mockReturnValue('dexto-source');

            const result = await requiresSetup();

            expect(result).toBe(false);
            expect(globalPreferencesExist).not.toHaveBeenCalled();
        });

        it('should not skip setup in global-cli context', async () => {
            vi.mocked(getExecutionContext).mockReturnValue('global-cli');
            vi.mocked(globalPreferencesExist).mockReturnValue(false);

            const result = await requiresSetup();

            expect(result).toBe(true);
        });

        it('should not skip setup in project context', async () => {
            vi.mocked(getExecutionContext).mockReturnValue('dexto-project');
            vi.mocked(globalPreferencesExist).mockReturnValue(false);

            const result = await requiresSetup();

            expect(result).toBe(true);
        });
    });

    describe('Project context', () => {
        beforeEach(() => {
            vi.mocked(getExecutionContext).mockReturnValue('dexto-project');
        });

        it('should not require setup when a project registry exists', async () => {
            vi.mocked(findDextoProjectRoot).mockReturnValue('/workspace');
            vi.mocked(findProjectRegistryPathSync).mockReturnValue(
                '/workspace/agents/registry.json'
            );

            const result = await requiresSetup();

            expect(result).toBe(false);
            expect(globalPreferencesExist).not.toHaveBeenCalled();
        });

        it('should require setup for first-time user', async () => {
            vi.mocked(globalPreferencesExist).mockReturnValue(false);

            const result = await requiresSetup();

            expect(result).toBe(true);
        });

        it('should validate existing preferences', async () => {
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
            expect(loadGlobalPreferences).toHaveBeenCalled();
        });
    });

    describe('First-time user (no preferences)', () => {
        beforeEach(() => {
            vi.mocked(globalPreferencesExist).mockReturnValue(false);
        });

        it('should require setup in source context', async () => {
            vi.mocked(getExecutionContext).mockReturnValue('dexto-source');

            const result = await requiresSetup();

            expect(result).toBe(true);
        });

        it('should require setup in global-cli context', async () => {
            vi.mocked(getExecutionContext).mockReturnValue('global-cli');

            const result = await requiresSetup();

            expect(result).toBe(true);
        });

        it('should require setup in project context', async () => {
            vi.mocked(getExecutionContext).mockReturnValue('dexto-project');

            const result = await requiresSetup();

            expect(result).toBe(true);
        });
    });

    describe('Has preferences', () => {
        beforeEach(() => {
            vi.mocked(globalPreferencesExist).mockReturnValue(true);
        });

        it('should not require setup with valid preferences in source context', async () => {
            vi.mocked(getExecutionContext).mockReturnValue('dexto-source');
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

        it('should not require setup with valid preferences in global-cli context', async () => {
            vi.mocked(getExecutionContext).mockReturnValue('global-cli');
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

        it('should require setup with incomplete setup flag', async () => {
            vi.mocked(getExecutionContext).mockReturnValue('dexto-source');
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

        it('should require setup with missing defaultAgent', async () => {
            vi.mocked(getExecutionContext).mockReturnValue('dexto-source');
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

        it('should require setup with corrupted preferences', async () => {
            vi.mocked(getExecutionContext).mockReturnValue('dexto-source');
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

    it('should return true when preferences do not exist', () => {
        vi.mocked(globalPreferencesExist).mockReturnValue(false);

        const result = isFirstTimeUser();

        expect(result).toBe(true);
    });

    it('should return false when preferences exist', () => {
        vi.mocked(globalPreferencesExist).mockReturnValue(true);

        const result = isFirstTimeUser();

        expect(result).toBe(false);
    });
});
