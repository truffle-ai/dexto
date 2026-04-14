import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { stripVTControlCharacters } from 'node:util';
import { handleSetupCommand, type CLISetupOptionsInput } from './setup.js';

const { mockCodexAppServerCreate, mockOpen, mockExecuteCommand, providerModels, llmRegistry } =
    vi.hoisted(() => {
        const providerModels = {
            anthropic: ['claude-haiku-4-5-20251001'],
            google: ['gemini-2.5-pro'],
            openai: ['gpt-4', 'gpt-4o', 'gpt-4o-mini', 'gpt-5', 'gpt-5-mini'],
            'openai-compatible': ['gpt-4', 'gpt-4o', 'gpt-4o-mini'],
            'dexto-nova': ['openai/gpt-5.2'],
            openrouter: ['openai/gpt-5.2-codex'],
            local: ['local-model'],
            ollama: ['llama3.1'],
        } as const;

        const llmRegistry = Object.fromEntries(
            Object.entries(providerModels).map(([provider, models]) => [
                provider,
                {
                    models: models.map((model) => ({
                        name: model,
                        model,
                        displayName: model,
                        description: `${model} description`,
                    })),
                },
            ])
        );

        return {
            mockCodexAppServerCreate: vi.fn(),
            mockOpen: vi.fn().mockResolvedValue(undefined),
            mockExecuteCommand: vi.fn(),
            providerModels,
            llmRegistry,
        };
    });

vi.mock('open', () => ({
    default: mockOpen,
}));

vi.mock('../utils/self-management.js', async () => {
    const actual = await vi.importActual<typeof import('../utils/self-management.js')>(
        '../utils/self-management.js'
    );
    return {
        ...actual,
        executeCommand: mockExecuteCommand,
    };
});

// Mock only external dependencies that can't be tested directly
vi.mock('@dexto/core', () => {
    const getModelsForProvider = (provider: string): string[] => [
        ...(providerModels[provider as keyof typeof providerModels] ?? ['test-model']),
    ];
    const isReasoningModel = (model: string): boolean =>
        model.includes('gpt-5') || model.includes('codex') || model.includes('claude');

    return {
        acceptsAnyModel: vi.fn(() => false),
        getCuratedModelsForProvider: vi.fn((provider: string) =>
            getModelsForProvider(provider)
                .slice(0, 8)
                .map((model, index) => ({
                    id: model,
                    model,
                    name: model,
                    displayName: model,
                    description: `${model} description`,
                    hidden: false,
                    isDefault: index === 0,
                    supportedReasoningEfforts: [],
                    defaultReasoningEffort: 'medium',
                }))
        ),
        getDefaultModelForProvider: vi.fn((provider: string) => getModelsForProvider(provider)[0]),
        getSupportedModels: vi.fn((provider: string) => getModelsForProvider(provider)),
        getReasoningProfile: vi.fn((_provider: string, model: string) =>
            isReasoningModel(model)
                ? {
                      capable: true,
                      supportedVariants: ['enabled', 'disabled'],
                      defaultVariant: 'enabled',
                  }
                : {
                      capable: false,
                      supportedVariants: [],
                      defaultVariant: undefined,
                  }
        ),
        isValidProviderModel: vi.fn((provider: string, model: string) =>
            getModelsForProvider(provider).includes(model)
        ),
        supportsCustomModels: vi.fn(() => false),
        resolveApiKeyForProvider: vi.fn(),
        requiresApiKey: vi.fn(
            (provider: string) =>
                !['local', 'ollama', 'dexto-nova', 'openai-compatible'].includes(provider)
        ),
        createCodexBaseURL: vi.fn((mode: string = 'chatgpt') => `codex://${mode}`),
        isCodexBaseURL: vi.fn(
            (value: unknown) => typeof value === 'string' && value.startsWith('codex://')
        ),
        parseCodexBaseURL: vi.fn((value: unknown) => {
            if (value === 'codex://chatgpt') {
                return { authMode: 'chatgpt' };
            }
            if (value === 'codex://apikey') {
                return { authMode: 'apikey' };
            }
            if (value === 'codex://auto' || value === 'codex://') {
                return { authMode: 'auto' };
            }
            return null;
        }),
        getCodexProviderDisplayName: vi.fn((mode: string = 'auto') => {
            if (mode === 'chatgpt') {
                return 'ChatGPT Login';
            }
            if (mode === 'apikey') {
                return 'ChatGPT Login (API key)';
            }
            return 'ChatGPT Login';
        }),
        getCodexAuthModeLabel: vi.fn((mode: string) => {
            if (mode === 'chatgpt') {
                return 'ChatGPT';
            }
            if (mode === 'apikey') {
                return 'API key';
            }
            return 'Auto';
        }),
        LLM_PROVIDERS: [
            'anthropic',
            'google',
            'openai',
            'openai-compatible',
            'dexto-nova',
            'openrouter',
            'local',
            'ollama',
        ],
        LLM_REGISTRY: llmRegistry,
        logger: {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
        CodexAppServerClient: {
            create: mockCodexAppServerCreate,
        },
    };
});

vi.mock('@dexto/agent-management', () => {
    return {
        createInitialPreferences: vi.fn((...args: any[]) => {
            const options = args[0];
            // Handle new options object signature
            if (typeof options === 'object' && 'provider' in options) {
                const llmConfig: any = { provider: options.provider, model: options.model };
                if (options.apiKeyVar) {
                    llmConfig.apiKey = `$${options.apiKeyVar}`;
                }
                if (options.baseURL) {
                    llmConfig.baseURL = options.baseURL;
                }
                return {
                    llm: llmConfig,
                    defaults: {
                        defaultAgent: options.defaultAgent || 'coding-agent',
                        defaultMode: options.defaultMode || 'cli',
                    },
                    setup: { completed: options.setupCompleted ?? true },
                };
            }
            // Legacy signature (provider, model, apiKeyVar, defaultAgent)
            return {
                llm: { provider: options, model: args[1], apiKey: `$${args[2]}` },
                defaults: { defaultAgent: args[3] || 'coding-agent' },
                setup: { completed: true },
            };
        }),
        saveGlobalPreferences: vi.fn().mockResolvedValue(undefined),
        loadGlobalPreferences: vi.fn().mockResolvedValue(null),
        getGlobalPreferencesPath: vi.fn(() => '/tmp/preferences.yml'),
        updateGlobalPreferences: vi.fn().mockResolvedValue(undefined),
        globalPreferencesExist: vi.fn(),
        setActiveModel: vi.fn().mockResolvedValue(undefined),
        isDextoAuthEnabled: vi.fn(() => false),
        loadCustomModels: vi.fn().mockResolvedValue([]),
        saveCustomModel: vi.fn().mockResolvedValue(undefined),
        deleteCustomModel: vi.fn().mockResolvedValue(undefined),
        getDextoGlobalPath: vi.fn((type: string, filename?: string) =>
            path.join('/tmp', '.dexto', type, filename ?? '')
        ),
    };
});

vi.mock('../../analytics/index.js', () => ({
    capture: vi.fn(),
}));

vi.mock('../utils/dexto-setup.js', () => ({
    canUseDextoProvider: vi.fn().mockResolvedValue(true),
}));

vi.mock('./auth/login.js', () => ({
    handleAutoLogin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../auth/index.js', () => ({
    loadAuth: vi.fn().mockResolvedValue(null),
    getBillingBalanceForCurrentLogin: vi.fn().mockResolvedValue(null),
    openDextoBillingPage: vi.fn().mockResolvedValue(undefined),
    getDextoApiClient: vi.fn(() => ({
        getUsageSummary: vi.fn().mockResolvedValue({ credits_usd: 0 }),
    })),
}));

vi.mock('../auth/constants.js', () => ({
    DEXTO_CREDITS_URL: 'https://example.com/credits',
}));

vi.mock('../utils/local-model-setup.js', () => ({
    setupLocalModels: vi.fn().mockResolvedValue({ success: false, cancelled: true }),
    setupOllamaModels: vi.fn().mockResolvedValue({ success: false, cancelled: true }),
    hasSelectedModel: vi.fn(
        (result: {
            success?: boolean;
            cancelled?: boolean;
            back?: boolean;
            skipped?: boolean;
            modelId?: string;
        }) =>
            Boolean(
                result.success &&
                    !result.cancelled &&
                    !result.back &&
                    !result.skipped &&
                    result.modelId
            )
    ),
    getModelFromResult: vi.fn((result: { modelId?: string }) => result.modelId ?? 'test-model'),
}));

vi.mock('../utils/api-key-setup.js', () => ({
    interactiveApiKeySetup: vi.fn().mockResolvedValue({ success: true }),
    hasApiKeyConfigured: vi.fn(() => true),
}));

vi.mock('../utils/provider-setup.js', () => ({
    selectProvider: vi.fn(),
    getProviderDisplayName: vi.fn((provider: string) => provider),
    getProviderEnvVar: vi.fn((provider: string) => `${provider.toUpperCase()}_API_KEY`),
    getProviderInfo: vi.fn(() => ({ apiKeyUrl: 'https://example.com' })),
    providerRequiresBaseURL: vi.fn(() => false),
    getDefaultModel: vi.fn(() => 'test-model'),
    validateApiKeyFormat: vi.fn(() => ({ valid: true })),
}));

vi.mock('../utils/setup-utils.js', () => ({
    requiresSetup: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
    intro: vi.fn(),
    note: vi.fn(),
    outro: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    isCancel: vi.fn(),
    select: vi.fn().mockResolvedValue('exit'),
    text: vi.fn().mockResolvedValue('test'),
    password: vi.fn().mockResolvedValue('test-key'),
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    log: { warn: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

describe('Setup Command', () => {
    let tempDir: string;
    let mockCreateInitialPreferences: any;
    let mockSaveGlobalPreferences: any;
    let mockLoadGlobalPreferences: any;
    let mockInteractiveApiKeySetup: any;
    let mockHasApiKeyConfigured: any;
    let mockSelectProvider: any;
    let mockRequiresSetup: any;
    let mockResolveApiKeyForProvider: any;
    let mockGlobalPreferencesExist: any;
    let mockManagedExecuteCommand: any;
    let mockPrompts: any;
    let consoleSpy: any;
    let consoleErrorSpy: any;
    let processExitSpy: any;

    function createTempDir() {
        return fs.mkdtempSync(path.join(tmpdir(), 'setup-test-'));
    }

    beforeEach(async () => {
        vi.clearAllMocks();
        tempDir = createTempDir();

        // Get mock functions
        const prefLoader = await import('@dexto/agent-management');
        const apiKeySetup = await import('../utils/api-key-setup.js');
        const apiKeyResolver = await import('@dexto/core');
        const providerSetup = await import('../utils/provider-setup.js');
        const setupUtils = await import('../utils/setup-utils.js');
        const prompts = await import('@clack/prompts');

        mockCreateInitialPreferences = vi.mocked(prefLoader.createInitialPreferences);
        mockSaveGlobalPreferences = vi.mocked(prefLoader.saveGlobalPreferences);
        mockLoadGlobalPreferences = vi.mocked(prefLoader.loadGlobalPreferences);
        mockGlobalPreferencesExist = vi.mocked(prefLoader.globalPreferencesExist);
        mockInteractiveApiKeySetup = vi.mocked(apiKeySetup.interactiveApiKeySetup);
        mockHasApiKeyConfigured = vi.mocked(apiKeySetup.hasApiKeyConfigured);
        mockResolveApiKeyForProvider = vi.mocked(apiKeyResolver.resolveApiKeyForProvider);
        mockSelectProvider = vi.mocked(providerSetup.selectProvider);
        mockRequiresSetup = vi.mocked(setupUtils.requiresSetup);
        mockManagedExecuteCommand = mockExecuteCommand;
        mockPrompts = {
            intro: vi.mocked(prompts.intro),
            note: vi.mocked(prompts.note),
            confirm: vi.mocked(prompts.confirm),
            cancel: vi.mocked(prompts.cancel),
            isCancel: vi.mocked(prompts.isCancel),
            select: vi.mocked(prompts.select),
            log: {
                error: vi.mocked(prompts.log.error),
                warn: vi.mocked(prompts.log.warn),
                success: vi.mocked(prompts.log.success),
                info: vi.mocked(prompts.log.info),
            },
        };

        // Reset mocks to default behavior - use new options object signature
        mockCreateInitialPreferences.mockImplementation((...args: any[]) => {
            const options = args[0];
            if (typeof options === 'object' && 'provider' in options) {
                const llmConfig: any = { provider: options.provider, model: options.model };
                if (options.apiKeyVar) {
                    llmConfig.apiKey = `$${options.apiKeyVar}`;
                }
                if (options.baseURL) {
                    llmConfig.baseURL = options.baseURL;
                }
                if (options.reasoning) {
                    llmConfig.reasoning = options.reasoning;
                }
                return {
                    llm: llmConfig,
                    defaults: {
                        defaultAgent: options.defaultAgent || 'coding-agent',
                        defaultMode: options.defaultMode || 'cli',
                    },
                    setup: { completed: options.setupCompleted ?? true },
                };
            }
            return {
                llm: { provider: options, model: args[1], apiKey: `$${args[2]}` },
                defaults: { defaultAgent: args[3] || 'coding-agent' },
                setup: { completed: true },
            };
        });
        mockSaveGlobalPreferences.mockResolvedValue(undefined);
        mockLoadGlobalPreferences.mockResolvedValue(null);
        mockGlobalPreferencesExist.mockReturnValue(true);
        mockInteractiveApiKeySetup.mockResolvedValue({ success: true });
        mockHasApiKeyConfigured.mockReturnValue(true); // Default: API key exists
        mockResolveApiKeyForProvider.mockReturnValue(undefined); // Default: no API key exists (for analytics)
        mockSelectProvider.mockResolvedValue(null);
        mockRequiresSetup.mockResolvedValue(true); // Default: setup is required
        mockPrompts.isCancel.mockReturnValue(false);
        mockPrompts.select.mockResolvedValue('exit'); // Default: exit settings menu
        mockCodexAppServerCreate.mockReset();
        mockOpen.mockReset();
        mockManagedExecuteCommand.mockReset();
        mockOpen.mockResolvedValue(undefined);
        mockManagedExecuteCommand.mockResolvedValue({
            code: 0,
            stdout: '',
            stderr: '',
        });

        // Mock console to prevent test output noise
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        processExitSpy = vi
            .spyOn(process, 'exit')
            .mockImplementation((code?: string | number | null | undefined) => {
                throw new Error(`Process exit called with code ${code}`);
            });
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        consoleSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        processExitSpy.mockRestore();
    });

    describe('Non-interactive setup', () => {
        it('creates preferences with provided options using new object signature', async () => {
            const options: CLISetupOptionsInput = {
                provider: 'openai',
                model: 'gpt-5',
                defaultAgent: 'my-agent',
                interactive: false,
            };

            await handleSetupCommand(options);

            expect(mockCreateInitialPreferences).toHaveBeenCalledWith({
                provider: 'openai',
                model: 'gpt-5',
                apiKeyVar: 'OPENAI_API_KEY',
                defaultAgent: 'my-agent',
                setupCompleted: true,
            });
            expect(mockSaveGlobalPreferences).toHaveBeenCalled();
            expect(mockInteractiveApiKeySetup).not.toHaveBeenCalled();
        });

        it('forwards defaultMode in non-interactive setup', async () => {
            const options: CLISetupOptionsInput = {
                provider: 'openai',
                model: 'gpt-5',
                defaultMode: 'server',
                interactive: false,
            };

            await handleSetupCommand(options);

            expect(mockCreateInitialPreferences).toHaveBeenCalledWith({
                provider: 'openai',
                model: 'gpt-5',
                apiKeyVar: 'OPENAI_API_KEY',
                defaultMode: 'server',
                defaultAgent: 'coding-agent',
                setupCompleted: true,
            });
        });

        it('uses default model when not specified', async () => {
            const options = {
                provider: 'anthropic' as const,
                interactive: false,
            };

            await handleSetupCommand(options);

            expect(mockCreateInitialPreferences).toHaveBeenCalledWith({
                provider: 'anthropic',
                model: 'test-model', // From mocked getDefaultModel
                apiKeyVar: 'ANTHROPIC_API_KEY',
                defaultAgent: 'coding-agent',
                setupCompleted: true,
            });
        });

        it('throws error when provider missing in non-interactive mode', async () => {
            const options = {
                interactive: false,
            };

            await expect(handleSetupCommand(options)).rejects.toThrow(
                'Provider required in non-interactive mode. Use --provider or --quick-start option.'
            );
        });

        it('exits with error when model required but not provided', async () => {
            // Mock getDefaultModel to return empty string for this provider (simulating no default)
            const providerSetup = await import('../utils/provider-setup.js');
            vi.mocked(providerSetup.getDefaultModel).mockReturnValueOnce('');

            const options = {
                provider: 'openai-compatible' as const, // Provider with no default model
                interactive: false,
            };

            await expect(handleSetupCommand(options)).rejects.toThrow(
                'Process exit called with code 1'
            );
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining("Model is required for provider 'openai-compatible'")
            );
        });
    });

    describe('Interactive setup', () => {
        it('configures ChatGPT Login with ChatGPT auth', async () => {
            const codexClient = {
                readAccount: vi.fn(),
                startLogin: vi.fn(),
                waitForLoginCompleted: vi.fn(),
                listModels: vi.fn(),
                logout: vi.fn(),
                close: vi.fn().mockResolvedValue(undefined),
            };

            codexClient.readAccount
                .mockResolvedValueOnce({ account: null, requiresOpenaiAuth: true })
                .mockResolvedValueOnce({
                    account: {
                        type: 'chatgpt',
                        email: 'dev@example.com',
                        planType: 'plus',
                    },
                    requiresOpenaiAuth: false,
                });
            codexClient.startLogin.mockResolvedValue({
                type: 'chatgpt',
                loginId: 'login-1',
                authUrl: 'https://chatgpt.example/login',
            });
            codexClient.waitForLoginCompleted.mockResolvedValue({
                loginId: 'login-1',
                success: true,
                error: null,
            });
            codexClient.listModels.mockResolvedValue([
                {
                    id: 'model-1',
                    model: 'gpt-4o-mini',
                    displayName: 'GPT-4o Mini',
                    description: 'Fast',
                    hidden: false,
                    isDefault: true,
                    supportedReasoningEfforts: [],
                    defaultReasoningEffort: 'medium',
                },
            ]);
            mockCodexAppServerCreate.mockResolvedValue(codexClient);

            mockPrompts.select
                .mockResolvedValueOnce('openai-codex')
                .mockResolvedValueOnce('gpt-4o-mini')
                .mockResolvedValueOnce('cli');

            await handleSetupCommand({ interactive: true });

            expect(mockCodexAppServerCreate).toHaveBeenCalled();
            expect(codexClient.startLogin).toHaveBeenCalledWith({ type: 'chatgpt' });
            expect(codexClient.waitForLoginCompleted).toHaveBeenCalledWith('login-1', {
                timeoutMs: 5 * 60 * 1000,
            });
            expect(mockOpen).toHaveBeenCalledWith('https://chatgpt.example/login');
            expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                expect.objectContaining({
                    provider: 'openai-compatible',
                    model: 'gpt-4o-mini',
                    baseURL: 'codex://chatgpt',
                    defaultMode: 'cli',
                    setupCompleted: true,
                    apiKeyPending: false,
                })
            );
            expect(mockSaveGlobalPreferences).toHaveBeenCalled();
            expect(codexClient.close).toHaveBeenCalled();
        });

        it('installs the Codex CLI automatically when ChatGPT Login setup needs it', async () => {
            const missingCodexError = new Error('spawn codex ENOENT') as NodeJS.ErrnoException;
            missingCodexError.code = 'ENOENT';
            const codexClient = {
                readAccount: vi.fn(),
                startLogin: vi.fn(),
                waitForLoginCompleted: vi.fn(),
                listModels: vi.fn(),
                logout: vi.fn(),
                close: vi.fn().mockResolvedValue(undefined),
            };

            codexClient.readAccount
                .mockResolvedValueOnce({ account: null, requiresOpenaiAuth: true })
                .mockResolvedValueOnce({
                    account: {
                        type: 'chatgpt',
                        email: 'dev@example.com',
                        planType: 'plus',
                    },
                    requiresOpenaiAuth: false,
                });
            codexClient.startLogin.mockResolvedValue({
                type: 'chatgpt',
                loginId: 'login-1',
                authUrl: 'https://chatgpt.example/login',
            });
            codexClient.waitForLoginCompleted.mockResolvedValue({
                loginId: 'login-1',
                success: true,
                error: null,
            });
            codexClient.listModels.mockResolvedValue([
                {
                    id: 'model-1',
                    model: 'gpt-4o-mini',
                    displayName: 'GPT-4o Mini',
                    description: 'Fast',
                    hidden: false,
                    isDefault: true,
                    supportedReasoningEfforts: [],
                    defaultReasoningEffort: 'medium',
                },
            ]);
            mockCodexAppServerCreate
                .mockRejectedValueOnce(missingCodexError)
                .mockResolvedValueOnce(codexClient);

            mockPrompts.select
                .mockResolvedValueOnce('openai-codex')
                .mockResolvedValueOnce('gpt-4o-mini')
                .mockResolvedValueOnce('cli');

            await handleSetupCommand({ interactive: true });

            expect(mockManagedExecuteCommand).toHaveBeenNthCalledWith(1, 'npm', ['--version']);
            expect(mockManagedExecuteCommand).toHaveBeenNthCalledWith(
                2,
                'npm',
                ['install', '@openai/codex', '--no-audit', '--no-fund'],
                expect.objectContaining({
                    cwd: expect.stringContaining('.dexto'),
                })
            );
            expect(mockCodexAppServerCreate).toHaveBeenCalledTimes(2);
            expect(codexClient.close).toHaveBeenCalled();
        });

        it('surfaces automatic Codex CLI install failures during ChatGPT Login setup', async () => {
            const missingCodexError = new Error('spawn codex ENOENT') as NodeJS.ErrnoException;
            missingCodexError.code = 'ENOENT';
            mockCodexAppServerCreate.mockRejectedValueOnce(missingCodexError);
            mockManagedExecuteCommand
                .mockResolvedValueOnce({
                    code: 0,
                    stdout: '10.0.0',
                    stderr: '',
                })
                .mockResolvedValueOnce({
                    code: 1,
                    stdout: '',
                    stderr: 'network unreachable',
                });

            const cancelToken = Symbol.for('cancel');
            mockPrompts.select
                .mockResolvedValueOnce('openai-codex')
                .mockResolvedValueOnce(cancelToken);
            mockPrompts.isCancel.mockImplementation((value: unknown) => value === cancelToken);

            await expect(handleSetupCommand({ interactive: true })).rejects.toThrow(
                'Process exit called with code 0'
            );

            expect(mockPrompts.log.error).toHaveBeenCalledWith(
                'ChatGPT Login setup failed: Failed to install the OpenAI Codex CLI via npm: network unreachable'
            );
        });

        it('shows setup type selection when interactive without provider', async () => {
            // User selects 'custom' setup, then provider selection happens
            // Wizard uses selectProvider for provider selection
            mockPrompts.select.mockResolvedValueOnce('custom'); // Setup type
            mockSelectProvider.mockResolvedValueOnce('anthropic'); // Provider (via selectProvider)
            mockPrompts.select.mockResolvedValueOnce('claude-haiku-4-5-20251001'); // Model
            mockPrompts.select.mockResolvedValueOnce('enabled'); // Reasoning variant (default)
            mockPrompts.select.mockResolvedValueOnce('web'); // Default mode

            const options = {
                interactive: true,
            };

            await handleSetupCommand(options);

            expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                expect.objectContaining({
                    provider: 'anthropic',
                    defaultMode: 'web',
                    setupCompleted: true,
                })
            );

            const [createOptions] = mockCreateInitialPreferences.mock.calls[0] ?? [];
            expect(createOptions?.reasoning).toBeUndefined();
        });

        it('handles quick start selection in interactive mode', async () => {
            // User selects 'quick' setup
            mockPrompts.select.mockResolvedValueOnce('quick'); // Setup type -> quick start
            mockPrompts.select.mockResolvedValueOnce('google'); // Provider picker -> google
            mockPrompts.confirm.mockResolvedValueOnce(true); // CLI mode confirmation -> yes
            mockHasApiKeyConfigured.mockReturnValue(true); // API key already configured

            const options = {
                interactive: true,
            };

            await handleSetupCommand(options);

            // Quick start uses Google provider with CLI mode
            expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                expect.objectContaining({
                    provider: 'google',
                    defaultMode: 'cli',
                    setupCompleted: true,
                })
            );
        });

        it('runs interactive API key setup when no API key exists', async () => {
            // New wizard flow uses p.select for setup type, selectProvider for provider
            mockPrompts.select.mockResolvedValueOnce('custom'); // Setup type
            mockSelectProvider.mockResolvedValueOnce('openai'); // Provider (via selectProvider)
            mockPrompts.select.mockResolvedValueOnce('gpt-4o'); // Model (must be valid OpenAI model from registry)
            mockPrompts.select.mockResolvedValueOnce('web'); // Default mode
            mockHasApiKeyConfigured.mockReturnValue(false); // No API key exists

            const options = {
                interactive: true,
            };

            await handleSetupCommand(options);

            // API key setup is called with provider and model
            expect(mockInteractiveApiKeySetup).toHaveBeenCalledWith(
                'openai',
                expect.objectContaining({
                    exitOnCancel: false,
                })
            );
        });

        it('skips interactive API key setup when API key already exists', async () => {
            mockPrompts.select.mockResolvedValueOnce('custom'); // Setup type
            mockSelectProvider.mockResolvedValueOnce('openai'); // Provider (via selectProvider)
            mockPrompts.select.mockResolvedValueOnce('gpt-4'); // Model
            mockPrompts.select.mockResolvedValueOnce('web'); // Default mode
            mockHasApiKeyConfigured.mockReturnValue(true); // API key exists

            const options = {
                interactive: true,
            };

            await handleSetupCommand(options);

            expect(mockInteractiveApiKeySetup).not.toHaveBeenCalled();
            expect(mockPrompts.log.success).toHaveBeenCalled();
        });

        it("treats 'Back' in model selection as navigation (does not persist _back as model)", async () => {
            mockPrompts.select
                .mockResolvedValueOnce('custom') // Setup type
                .mockResolvedValueOnce('_back') // Model -> back to provider selection
                .mockResolvedValueOnce('gpt-4o-mini') // Model (non-reasoning)
                .mockResolvedValueOnce('cli'); // Default mode

            mockSelectProvider.mockResolvedValueOnce('openai').mockResolvedValueOnce('openai');
            mockHasApiKeyConfigured.mockReturnValue(true); // API key exists (apiKey step auto-skips)

            await handleSetupCommand({ interactive: true });

            expect(mockSelectProvider).toHaveBeenCalledTimes(2);
            expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                expect.objectContaining({
                    provider: 'openai',
                    model: 'gpt-4o-mini',
                    defaultMode: 'cli',
                })
            );
        });

        it('navigates back from mode to reasoning when apiKey step is auto-skipped (prevents back-bounce)', async () => {
            mockPrompts.select
                .mockResolvedValueOnce('custom') // Setup type
                .mockResolvedValueOnce('claude-haiku-4-5-20251001') // Model
                .mockResolvedValueOnce('enabled') // Reasoning variant
                .mockResolvedValueOnce('_back') // Mode -> back
                .mockResolvedValueOnce('enabled') // Reasoning variant (again)
                .mockResolvedValueOnce('cli'); // Mode

            mockSelectProvider.mockResolvedValueOnce('anthropic');
            mockHasApiKeyConfigured.mockReturnValue(true); // API key exists (apiKey step auto-skips)

            await handleSetupCommand({ interactive: true });

            const selectMessages: Array<string | undefined> = mockPrompts.select.mock.calls.map(
                (call: unknown[]) => {
                    const firstArg = call[0];
                    if (typeof firstArg !== 'object' || firstArg === null) {
                        return undefined;
                    }

                    const message = Reflect.get(firstArg, 'message');
                    return typeof message === 'string' ? message : undefined;
                }
            );
            const firstModeIndex = selectMessages.findIndex(
                (message) => message === 'How do you want to use Dexto by default?'
            );
            expect(firstModeIndex).toBeGreaterThan(-1);
            expect(selectMessages[firstModeIndex + 1]).toBe('Select reasoning variant');
        });

        it('cancels setup when user cancels setup type selection', async () => {
            mockPrompts.select.mockResolvedValueOnce(Symbol.for('cancel')); // Cancel
            mockPrompts.isCancel.mockReturnValue(true);

            const options = {
                interactive: true,
            };

            await expect(handleSetupCommand(options)).rejects.toThrow(
                'Process exit called with code 0'
            );
        });
    });

    describe('Validation', () => {
        it('validates schema correctly with defaults and uses new options signature', async () => {
            // Interactive mode with provider - goes through full setup flow
            mockPrompts.select.mockResolvedValueOnce('custom'); // Setup type
            mockSelectProvider.mockResolvedValueOnce('google'); // Provider (via selectProvider)
            mockPrompts.select.mockResolvedValueOnce('gemini-2.5-pro'); // Model
            mockPrompts.select.mockResolvedValueOnce('web'); // Default mode

            const options = {
                provider: 'google' as const,
            };

            await handleSetupCommand(options);

            // Should apply defaults: interactive=true, defaultAgent='coding-agent'
            expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                expect.objectContaining({
                    provider: 'google',
                    setupCompleted: true,
                })
            );
        });

        it('throws ZodError for invalid provider', async () => {
            const options = {
                provider: 'invalid-provider',
                interactive: false,
            } as any;

            await expect(handleSetupCommand(options)).rejects.toThrow();
        });

        it('throws validation error for empty model name', async () => {
            const options = {
                provider: 'openai',
                model: '',
                interactive: false,
            } as any;

            await expect(handleSetupCommand(options)).rejects.toThrow();
        });

        it('throws validation error for empty default agent', async () => {
            const options = {
                provider: 'openai',
                defaultAgent: '',
                interactive: false,
            } as any;

            await expect(handleSetupCommand(options)).rejects.toThrow();
        });

        it('handles strict mode validation correctly', async () => {
            const options = {
                provider: 'openai',
                unknownField: 'should-cause-error',
                interactive: false,
            } as any;

            await expect(handleSetupCommand(options)).rejects.toThrow();
        });
    });

    describe('Error handling', () => {
        it('propagates errors from createInitialPreferences', async () => {
            mockCreateInitialPreferences.mockImplementation(() => {
                throw new Error('Failed to create preferences');
            });

            const options = {
                provider: 'openai' as const,
                interactive: false,
            };

            await expect(handleSetupCommand(options)).rejects.toThrow(
                'Failed to create preferences'
            );
        });

        it('propagates errors from saveGlobalPreferences', async () => {
            // Reset createInitialPreferences to new options signature
            mockCreateInitialPreferences.mockImplementation((options: any) => ({
                llm: {
                    provider: options.provider,
                    model: options.model,
                    apiKey: `$${options.apiKeyVar}`,
                },
                defaults: {
                    defaultAgent: options.defaultAgent || 'coding-agent',
                    defaultMode: 'cli',
                },
                setup: { completed: true },
            }));
            mockSaveGlobalPreferences.mockRejectedValue(new Error('Failed to save preferences'));

            const options = {
                provider: 'openai' as const,
                interactive: false,
            };

            await expect(handleSetupCommand(options)).rejects.toThrow('Failed to save preferences');
        });

        it('propagates errors from interactiveApiKeySetup', async () => {
            // Reset to new options signature
            mockCreateInitialPreferences.mockImplementation((options: any) => ({
                llm: {
                    provider: options.provider,
                    model: options.model,
                    apiKey: `$${options.apiKeyVar}`,
                },
                defaults: {
                    defaultAgent: options.defaultAgent || 'coding-agent',
                    defaultMode: 'cli',
                },
                setup: { completed: true },
            }));
            mockSaveGlobalPreferences.mockResolvedValue(undefined);
            mockHasApiKeyConfigured.mockReturnValue(false); // No API key exists
            // Simulate a thrown error (not just a failed result)
            mockInteractiveApiKeySetup.mockRejectedValue(new Error('API key setup failed'));

            // Setup mocks for interactive flow
            mockPrompts.select.mockResolvedValueOnce('custom'); // Setup type
            mockSelectProvider.mockResolvedValueOnce('openai'); // Provider (via selectProvider)
            mockPrompts.select.mockResolvedValueOnce('gpt-4'); // Model
            mockPrompts.select.mockResolvedValueOnce('web'); // Mode (won't be reached due to error)

            const options = {
                interactive: true,
            };

            await expect(handleSetupCommand(options)).rejects.toThrow('API key setup failed');
        });
    });

    describe('Edge cases', () => {
        it('works correctly with multiple providers in non-interactive mode', async () => {
            const testCases = [
                {
                    provider: 'openai',
                    expectedKey: 'OPENAI_API_KEY',
                },
                {
                    provider: 'anthropic',
                    expectedKey: 'ANTHROPIC_API_KEY',
                },
                {
                    provider: 'google',
                    expectedKey: 'GOOGLE_API_KEY',
                },
            ] as const;

            for (const testCase of testCases) {
                // Reset mocks for each test case
                mockCreateInitialPreferences.mockClear();
                mockSaveGlobalPreferences.mockClear();
                mockInteractiveApiKeySetup.mockClear();

                const options = {
                    provider: testCase.provider,
                    interactive: false,
                };

                await handleSetupCommand(options);

                expect(mockCreateInitialPreferences).toHaveBeenCalledWith({
                    provider: testCase.provider,
                    model: 'test-model', // From mocked getDefaultModel
                    apiKeyVar: testCase.expectedKey,
                    defaultAgent: 'coding-agent',
                    setupCompleted: true,
                });
            }
        });

        it('preserves user-provided model over default', async () => {
            // Reset to new options signature
            mockCreateInitialPreferences.mockImplementation((options: any) => ({
                llm: {
                    provider: options.provider,
                    model: options.model,
                    apiKey: `$${options.apiKeyVar}`,
                },
                defaults: {
                    defaultAgent: options.defaultAgent || 'coding-agent',
                    defaultMode: 'cli',
                },
                setup: { completed: true },
            }));

            const options = {
                provider: 'openai' as const,
                model: 'gpt-5-mini',
                interactive: false,
            };

            await handleSetupCommand(options);

            expect(mockCreateInitialPreferences).toHaveBeenCalledWith({
                provider: 'openai',
                model: 'gpt-5-mini', // User-specified model, not default
                apiKeyVar: 'OPENAI_API_KEY',
                defaultAgent: 'coding-agent',
                setupCompleted: true,
            });
        });
    });

    describe('Re-setup scenarios', () => {
        beforeEach(() => {
            // Setup is already complete for these tests
            mockRequiresSetup.mockResolvedValue(false);
        });

        describe('Non-interactive re-setup', () => {
            it('errors without --force flag when setup is already complete', async () => {
                const options = {
                    provider: 'openai' as const,
                    interactive: false,
                    force: false,
                };

                await expect(handleSetupCommand(options)).rejects.toThrow(
                    'Process exit called with code 1'
                );

                expect(consoleErrorSpy).toHaveBeenCalledWith(
                    expect.stringContaining('Setup is already complete')
                );
                expect(mockCreateInitialPreferences).not.toHaveBeenCalled();
            });

            it('proceeds with --force flag when setup is already complete', async () => {
                const options = {
                    provider: 'openai' as const,
                    interactive: false,
                    force: true,
                };

                await handleSetupCommand(options);

                expect(mockCreateInitialPreferences).toHaveBeenCalledWith({
                    provider: 'openai',
                    model: 'test-model', // From mocked getDefaultModel
                    apiKeyVar: 'OPENAI_API_KEY',
                    defaultAgent: 'coding-agent',
                    setupCompleted: true,
                });
                expect(mockSaveGlobalPreferences).toHaveBeenCalled();
                expect(processExitSpy).not.toHaveBeenCalled();
            });
        });

        describe('Interactive re-setup (Settings Menu)', () => {
            it('shows Codex-specific labels for a saved ChatGPT-backed config', async () => {
                mockLoadGlobalPreferences.mockResolvedValue({
                    llm: {
                        provider: 'openai-compatible',
                        model: 'gpt-4o-mini',
                        baseURL: 'codex://chatgpt',
                    },
                    defaults: {
                        defaultMode: 'cli',
                    },
                    setup: { completed: true },
                });
                mockPrompts.select.mockResolvedValueOnce('exit');

                await handleSetupCommand({ interactive: true });

                const stripAnsi = (value: unknown) =>
                    typeof value === 'string' ? stripVTControlCharacters(value) : String(value);
                const [noteText] = mockPrompts.note.mock.calls[0] ?? [];
                expect(stripAnsi(noteText)).toContain('Provider: ChatGPT Login');
                expect(stripAnsi(noteText)).toContain('Authentication: ChatGPT');

                const [settingsSelect] = mockPrompts.select.mock.calls[0] ?? [];
                expect(settingsSelect.options).toEqual(
                    expect.arrayContaining([
                        expect.objectContaining({
                            value: 'auth',
                            label: 'Manage ChatGPT login',
                            hint: 'Verify or reconnect your ChatGPT login for Codex',
                        }),
                    ])
                );
            });

            it('shows settings menu when setup is already complete', async () => {
                // User selects 'exit' from settings menu
                mockPrompts.select.mockResolvedValueOnce('exit');

                const options = {
                    interactive: true,
                };

                await handleSetupCommand(options);

                // Should show settings menu intro
                expect(mockPrompts.intro).toHaveBeenCalledWith(expect.stringContaining('Settings'));
                // Should not try to create new preferences when exiting
                expect(mockCreateInitialPreferences).not.toHaveBeenCalled();
            });

            it('exits gracefully when user cancels from settings menu', async () => {
                mockPrompts.select.mockResolvedValueOnce(Symbol.for('cancel'));
                mockPrompts.isCancel.mockReturnValue(true);

                const options = {
                    interactive: true,
                };

                await handleSetupCommand(options);

                // Should not throw, just exit gracefully
                expect(mockCreateInitialPreferences).not.toHaveBeenCalled();
            });

            it('re-enters setup when preferences are missing', async () => {
                mockGlobalPreferencesExist.mockReturnValue(false);
                mockPrompts.select.mockResolvedValueOnce(Symbol.for('cancel'));
                mockPrompts.isCancel.mockReturnValue(true);

                const options = {
                    interactive: true,
                };

                await expect(handleSetupCommand(options)).rejects.toThrow(
                    'Process exit called with code 0'
                );

                expect(mockPrompts.log.warn).toHaveBeenCalledWith(
                    expect.stringContaining('No preferences found')
                );
            });
        });

        it('proceeds normally when setup is required despite preferences existing', async () => {
            // Edge case: preferences exist but are incomplete/corrupted
            mockRequiresSetup.mockResolvedValue(true);

            const options = {
                provider: 'openai' as const,
                interactive: false,
            };

            await handleSetupCommand(options);

            expect(mockCreateInitialPreferences).toHaveBeenCalled();
            expect(mockSaveGlobalPreferences).toHaveBeenCalled();
        });
    });

    describe('Quick start flow', () => {
        it('handles --quick-start flag in non-interactive mode', async () => {
            mockPrompts.select.mockResolvedValueOnce('google'); // Provider picker
            mockPrompts.confirm.mockResolvedValueOnce(true); // CLI mode confirmation
            mockHasApiKeyConfigured.mockReturnValue(true);

            const options = {
                quickStart: true,
                interactive: false,
            };

            // Note: quickStart triggers the quick start flow even in non-interactive
            await handleSetupCommand(options);

            expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                expect.objectContaining({
                    provider: 'google',
                    defaultMode: 'cli',
                    setupCompleted: true,
                })
            );
        });

        it('prompts for API key if not configured during quick start', async () => {
            mockPrompts.select.mockResolvedValueOnce('google'); // Provider picker
            mockPrompts.confirm.mockResolvedValueOnce(true); // CLI mode confirmation
            mockHasApiKeyConfigured.mockReturnValue(false);
            mockInteractiveApiKeySetup.mockResolvedValue({ success: true });

            const options = {
                quickStart: true,
            };

            await handleSetupCommand(options);

            expect(mockInteractiveApiKeySetup).toHaveBeenCalledWith(
                'google',
                expect.objectContaining({
                    exitOnCancel: false,
                })
            );
        });

        it('handles API key skip during quick start', async () => {
            mockPrompts.select.mockResolvedValueOnce('google'); // Provider picker
            mockPrompts.confirm.mockResolvedValueOnce(true); // CLI mode confirmation
            mockHasApiKeyConfigured.mockReturnValue(false);
            mockInteractiveApiKeySetup.mockResolvedValue({ success: true, skipped: true });

            const options = {
                quickStart: true,
            };

            await handleSetupCommand(options);

            // Should save preferences with apiKeyPending flag set to true
            expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                expect.objectContaining({
                    provider: 'google',
                    apiKeyPending: true,
                    setupCompleted: true,
                })
            );
            expect(mockSaveGlobalPreferences).toHaveBeenCalled();
        });

        it('sets apiKeyPending to false when API key is provided', async () => {
            // Reset mocks to ensure clean state
            mockPrompts.select.mockReset();
            mockPrompts.confirm.mockReset();
            mockPrompts.select.mockResolvedValueOnce('google'); // Provider picker
            mockPrompts.confirm.mockResolvedValueOnce(true); // CLI mode confirmation

            mockHasApiKeyConfigured.mockReturnValue(false);
            // interactiveApiKeySetup returns success without skipped flag - API key was provided
            mockInteractiveApiKeySetup.mockResolvedValue({ success: true, apiKey: 'test-key' });

            const options = {
                quickStart: true,
            };

            await handleSetupCommand(options);

            // Should save preferences with apiKeyPending false
            expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                expect.objectContaining({
                    provider: 'google',
                    apiKeyPending: false,
                    setupCompleted: true,
                })
            );
        });
    });
});
