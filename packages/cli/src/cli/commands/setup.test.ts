import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { handleSetupCommand, type CLISetupOptionsInput } from './setup.js';

// Mock only external dependencies that can't be tested directly
vi.mock('@dexto/core', async () => {
    const actual = await vi.importActual<typeof import('@dexto/core')>('@dexto/core');
    return {
        ...actual,
        getCuratedModelsForProvider: vi.fn((provider: any) => {
            const models = (actual as any).LLM_REGISTRY?.[provider]?.models ?? [];
            return Array.isArray(models) ? models.slice(0, 8) : [];
        }),
        resolveApiKeyForProvider: vi.fn(),
        requiresApiKey: vi.fn(() => true), // Most providers need API keys
    };
});

vi.mock('@dexto/agent-management', async () => {
    const actual =
        await vi.importActual<typeof import('@dexto/agent-management')>('@dexto/agent-management');
    return {
        ...actual,
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
                        defaultMode: options.defaultMode || 'web',
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
    };
});

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
    let mockInteractiveApiKeySetup: any;
    let mockHasApiKeyConfigured: any;
    let mockSelectProvider: any;
    let mockRequiresSetup: any;
    let mockResolveApiKeyForProvider: any;
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
        mockInteractiveApiKeySetup = vi.mocked(apiKeySetup.interactiveApiKeySetup);
        mockHasApiKeyConfigured = vi.mocked(apiKeySetup.hasApiKeyConfigured);
        mockResolveApiKeyForProvider = vi.mocked(apiKeyResolver.resolveApiKeyForProvider);
        mockSelectProvider = vi.mocked(providerSetup.selectProvider);
        mockRequiresSetup = vi.mocked(setupUtils.requiresSetup);
        mockPrompts = {
            intro: vi.mocked(prompts.intro),
            note: vi.mocked(prompts.note),
            confirm: vi.mocked(prompts.confirm),
            cancel: vi.mocked(prompts.cancel),
            isCancel: vi.mocked(prompts.isCancel),
            select: vi.mocked(prompts.select),
            log: {
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
                return {
                    llm: llmConfig,
                    defaults: {
                        defaultAgent: options.defaultAgent || 'coding-agent',
                        defaultMode: options.defaultMode || 'web',
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
        mockInteractiveApiKeySetup.mockResolvedValue({ success: true });
        mockHasApiKeyConfigured.mockReturnValue(true); // Default: API key exists
        mockResolveApiKeyForProvider.mockReturnValue(undefined); // Default: no API key exists (for analytics)
        mockSelectProvider.mockResolvedValue(null);
        mockRequiresSetup.mockResolvedValue(true); // Default: setup is required
        mockPrompts.isCancel.mockReturnValue(false);
        mockPrompts.select.mockResolvedValue('exit'); // Default: exit settings menu

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
        it('shows setup type selection when interactive without provider', async () => {
            // User selects 'custom' setup, then provider selection happens
            // Wizard uses selectProvider for provider selection
            mockPrompts.select.mockResolvedValueOnce('custom'); // Setup type
            mockSelectProvider.mockResolvedValueOnce('anthropic'); // Provider (via selectProvider)
            mockPrompts.select.mockResolvedValueOnce('claude-haiku-4-5-20251001'); // Model
            mockPrompts.select.mockResolvedValueOnce('auto'); // Reasoning preset (if model supports it)
            mockPrompts.select.mockResolvedValueOnce('web'); // Default mode

            const options = {
                interactive: true,
            };

            await handleSetupCommand(options);

            expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                expect.objectContaining({
                    provider: 'anthropic',
                    defaultMode: 'web',
                    reasoning: { preset: 'auto' },
                    setupCompleted: true,
                })
            );
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
                    defaultMode: 'web',
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
                    defaultMode: 'web',
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
                    defaultMode: 'web',
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
