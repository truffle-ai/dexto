import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { handleSetupCommand, type CLISetupOptionsInput } from './setup.js';

// Mock only external dependencies that can't be tested directly
vi.mock('@core/preferences/loader.js', () => ({
    createInitialPreferences: vi.fn((provider, model, apiKeyVar, defaultAgent) => ({
        llm: { provider, model, apiKey: apiKeyVar },
        defaults: { defaultAgent },
        setup: { completed: true },
    })),
    saveGlobalPreferences: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@app/cli/utils/api-key-setup.js', () => ({
    interactiveApiKeySetup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@app/cli/utils/provider-setup.js', () => ({
    selectProvider: vi.fn(),
}));

vi.mock('@app/cli/utils/setup-utils.js', () => ({
    requiresSetup: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
    intro: vi.fn(),
    note: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    isCancel: vi.fn(),
    log: { warn: vi.fn() },
}));

describe('Setup Command', () => {
    let tempDir: string;
    let mockCreateInitialPreferences: any;
    let mockSaveGlobalPreferences: any;
    let mockInteractiveApiKeySetup: any;
    let mockSelectProvider: any;
    let mockRequiresSetup: any;
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
        const prefLoader = await import('@core/preferences/loader.js');
        const apiKeySetup = await import('@app/cli/utils/api-key-setup.js');
        const providerSetup = await import('@app/cli/utils/provider-setup.js');
        const setupUtils = await import('@app/cli/utils/setup-utils.js');
        const prompts = await import('@clack/prompts');

        mockCreateInitialPreferences = vi.mocked(prefLoader.createInitialPreferences);
        mockSaveGlobalPreferences = vi.mocked(prefLoader.saveGlobalPreferences);
        mockInteractiveApiKeySetup = vi.mocked(apiKeySetup.interactiveApiKeySetup);
        mockSelectProvider = vi.mocked(providerSetup.selectProvider);
        mockRequiresSetup = vi.mocked(setupUtils.requiresSetup);
        mockPrompts = {
            intro: vi.mocked(prompts.intro),
            note: vi.mocked(prompts.note),
            confirm: vi.mocked(prompts.confirm),
            cancel: vi.mocked(prompts.cancel),
            isCancel: vi.mocked(prompts.isCancel),
            log: { warn: vi.mocked(prompts.log.warn) },
        };

        // Reset mocks to default behavior
        mockCreateInitialPreferences.mockImplementation(
            (provider: string, model: string, apiKeyVar: string, defaultAgent: string) => ({
                llm: { provider, model, apiKey: apiKeyVar },
                defaults: { defaultAgent },
                setup: { completed: true },
            })
        );
        mockSaveGlobalPreferences.mockResolvedValue(undefined);
        mockInteractiveApiKeySetup.mockResolvedValue(undefined);
        mockSelectProvider.mockResolvedValue(null);
        mockRequiresSetup.mockResolvedValue(true); // Default: setup is required
        mockPrompts.isCancel.mockReturnValue(false);

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
        it('creates preferences with provided options', async () => {
            const options: CLISetupOptionsInput = {
                provider: 'openai',
                model: 'gpt-4o',
                defaultAgent: 'my-agent',
                interactive: false,
            };

            await handleSetupCommand(options);

            expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                'openai',
                'gpt-4o',
                'OPENAI_API_KEY',
                'my-agent'
            );
            expect(mockSaveGlobalPreferences).toHaveBeenCalled();
            expect(mockInteractiveApiKeySetup).not.toHaveBeenCalled();
        });

        it('uses default model when not specified', async () => {
            const options = {
                provider: 'anthropic' as const,
                interactive: false,
            };

            await handleSetupCommand(options);

            expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                'anthropic',
                'claude-4-sonnet-20250514', // Real default from registry
                'ANTHROPIC_API_KEY',
                'default-agent'
            );
        });

        it('throws error when provider missing in non-interactive mode', async () => {
            const options = {
                interactive: false,
            };

            await expect(handleSetupCommand(options)).rejects.toThrow(
                'Provider required in non-interactive mode. Use --provider option.'
            );
        });

        it('throws error when provider requires specific model but none provided', async () => {
            const options = {
                provider: 'openai-compatible' as const, // Provider with no default model
                interactive: false,
            };

            await expect(handleSetupCommand(options)).rejects.toThrow(
                "Provider 'openai-compatible' requires a specific model. Use --model option."
            );
        });
    });

    describe('Interactive setup', () => {
        it('prompts for provider when not specified', async () => {
            mockSelectProvider.mockResolvedValue('anthropic');

            const options = {
                interactive: true,
            };

            await handleSetupCommand(options);

            expect(mockSelectProvider).toHaveBeenCalled();
            expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                'anthropic',
                'claude-4-sonnet-20250514',
                'ANTHROPIC_API_KEY',
                'default-agent'
            );
        });

        it('runs interactive API key setup by default', async () => {
            const options = {
                provider: 'openai' as const,
                interactive: true,
            };

            await handleSetupCommand(options);

            expect(mockInteractiveApiKeySetup).toHaveBeenCalledWith('openai');
        });
    });

    describe('Validation', () => {
        it('validates schema correctly with defaults', async () => {
            const options = {
                provider: 'google' as const,
            };

            await handleSetupCommand(options);

            // Should apply defaults: interactive=true, defaultAgent='default-agent'
            expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                'google',
                'gemini-2.5-pro',
                'GOOGLE_GENERATIVE_AI_API_KEY',
                'default-agent'
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
            // Reset createInitialPreferences to default behavior first
            mockCreateInitialPreferences.mockImplementation(
                (provider: string, model: string, apiKeyVar: string, defaultAgent: string) => ({
                    llm: { provider, model, apiKey: apiKeyVar },
                    defaults: { defaultAgent },
                    setup: { completed: true },
                })
            );
            mockSaveGlobalPreferences.mockRejectedValue(new Error('Failed to save preferences'));

            const options = {
                provider: 'openai' as const,
                interactive: false,
            };

            await expect(handleSetupCommand(options)).rejects.toThrow('Failed to save preferences');
        });

        it('propagates errors from interactiveApiKeySetup', async () => {
            // Reset to default behavior first
            mockCreateInitialPreferences.mockImplementation(
                (provider: string, model: string, apiKeyVar: string, defaultAgent: string) => ({
                    llm: { provider, model, apiKey: apiKeyVar },
                    defaults: { defaultAgent },
                    setup: { completed: true },
                })
            );
            mockSaveGlobalPreferences.mockResolvedValue(undefined);
            mockInteractiveApiKeySetup.mockRejectedValue(new Error('API key setup failed'));

            const options = {
                provider: 'openai' as const,
                interactive: true,
            };

            await expect(handleSetupCommand(options)).rejects.toThrow('API key setup failed');
        });
    });

    describe('Edge cases', () => {
        it('works correctly with all supported providers', async () => {
            const testCases = [
                {
                    provider: 'openai',
                    expectedModel: 'gpt-4.1-mini',
                    expectedKey: 'OPENAI_API_KEY',
                },
                {
                    provider: 'anthropic',
                    expectedModel: 'claude-4-sonnet-20250514',
                    expectedKey: 'ANTHROPIC_API_KEY',
                },
                {
                    provider: 'google',
                    expectedModel: 'gemini-2.5-pro',
                    expectedKey: 'GOOGLE_GENERATIVE_AI_API_KEY',
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

                expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                    testCase.provider,
                    testCase.expectedModel,
                    testCase.expectedKey,
                    'default-agent'
                );
            }
        });

        it('preserves user-provided model over default', async () => {
            // Reset to default behavior first
            mockCreateInitialPreferences.mockImplementation(
                (provider: string, model: string, apiKeyVar: string, defaultAgent: string) => ({
                    llm: { provider, model, apiKey: apiKeyVar },
                    defaults: { defaultAgent },
                    setup: { completed: true },
                })
            );

            const options = {
                provider: 'openai' as const,
                model: 'gpt-4o-mini',
                interactive: false,
            };

            await handleSetupCommand(options);

            expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                'openai',
                'gpt-4o-mini', // User-specified model, not default
                'OPENAI_API_KEY',
                'default-agent'
            );
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

                expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                    'openai',
                    'gpt-4.1-mini',
                    'OPENAI_API_KEY',
                    'default-agent'
                );
                expect(mockSaveGlobalPreferences).toHaveBeenCalled();
                expect(processExitSpy).not.toHaveBeenCalled();
            });
        });

        describe('Interactive re-setup', () => {
            it('cancels when user declines to overwrite setup', async () => {
                mockPrompts.confirm.mockResolvedValue(false);

                const options = {
                    provider: 'openai' as const,
                    interactive: true,
                };

                await expect(handleSetupCommand(options)).rejects.toThrow(
                    'Process exit called with code 0'
                );

                expect(mockPrompts.intro).toHaveBeenCalledWith(
                    expect.stringContaining('Setup Already Complete')
                );
                expect(mockPrompts.confirm).toHaveBeenCalledWith({
                    message: 'Do you want to continue and overwrite your current setup?',
                    initialValue: false,
                });
                expect(mockPrompts.cancel).toHaveBeenCalledWith(
                    'Setup cancelled. Your existing configuration remains unchanged.'
                );
                expect(mockCreateInitialPreferences).not.toHaveBeenCalled();
            });

            it('proceeds when user confirms overwrite', async () => {
                mockPrompts.confirm.mockResolvedValue(true);

                const options = {
                    provider: 'openai' as const,
                    interactive: true,
                };

                await handleSetupCommand(options);

                expect(mockPrompts.intro).toHaveBeenCalled();
                expect(mockPrompts.confirm).toHaveBeenCalled();
                expect(mockPrompts.log.warn).toHaveBeenCalledWith(
                    'Proceeding with setup override...'
                );
                expect(mockCreateInitialPreferences).toHaveBeenCalledWith(
                    'openai',
                    'gpt-4.1-mini',
                    'OPENAI_API_KEY',
                    'default-agent'
                );
                expect(mockSaveGlobalPreferences).toHaveBeenCalled();
            });

            it('handles user cancellation during confirmation prompt', async () => {
                mockPrompts.confirm.mockResolvedValue(false);
                mockPrompts.isCancel.mockReturnValue(true);

                const options = {
                    provider: 'openai' as const,
                    interactive: true,
                };

                await expect(handleSetupCommand(options)).rejects.toThrow(
                    'Process exit called with code 0'
                );

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

            expect(mockPrompts.intro).not.toHaveBeenCalled();
            expect(mockCreateInitialPreferences).toHaveBeenCalled();
            expect(mockSaveGlobalPreferences).toHaveBeenCalled();
        });
    });
});
