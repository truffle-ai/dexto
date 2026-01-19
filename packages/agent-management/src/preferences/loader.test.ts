import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import {
    loadGlobalPreferences,
    saveGlobalPreferences,
    globalPreferencesExist,
    getGlobalPreferencesPath,
    createInitialPreferences,
    updateGlobalPreferences,
} from './loader.js';
import { type GlobalPreferences } from './schemas.js';
import { PreferenceErrorCode } from './error-codes.js';
import { ErrorType } from '@dexto/core';

// Mock getDextoGlobalPath to use a temporary directory
import * as pathUtils from '../utils/path.js';
import { vi } from 'vitest';

describe('Preferences Loader', () => {
    let tempDir: string;
    let mockPreferencesPath: string;
    let samplePreferences: GlobalPreferences;

    beforeEach(async () => {
        // Create temporary directory for each test
        tempDir = await fs.mkdtemp(path.join(tmpdir(), 'dexto-preferences-test-'));
        mockPreferencesPath = path.join(tempDir, 'preferences.yml');

        // Mock getDextoGlobalPath to return our test path
        vi.spyOn(pathUtils, 'getDextoGlobalPath').mockImplementation(
            (type: string, filename?: string) => {
                if (type === 'preferences.yml' || filename === 'preferences.yml') {
                    return mockPreferencesPath;
                }
                if (filename) {
                    return path.join(tempDir, filename);
                }
                // For nested directory test, return proper structure
                if (type.includes('nested')) {
                    return type;
                }
                return tempDir;
            }
        );

        // Sample preferences object
        samplePreferences = {
            llm: {
                provider: 'anthropic',
                model: 'claude-4-sonnet-20250514',
                apiKey: '$ANTHROPIC_API_KEY',
            },
            defaults: {
                defaultAgent: 'test-agent',
                defaultMode: 'web',
            },
            setup: {
                completed: true,
                apiKeyPending: false,
                baseURLPending: false,
            },
            sounds: {
                enabled: true,
                onApprovalRequired: true,
                onTaskComplete: true,
            },
            preferDextoCredits: true,
        };
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        // Clean up temporary directory
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    describe('globalPreferencesExist', () => {
        it('should return false when preferences file does not exist', () => {
            expect(globalPreferencesExist()).toBe(false);
        });

        it('should return true when preferences file exists', async () => {
            await saveGlobalPreferences(samplePreferences);
            expect(globalPreferencesExist()).toBe(true);
        });
    });

    describe('getGlobalPreferencesPath', () => {
        it('should return the correct preferences file path', () => {
            const preferencesPath = getGlobalPreferencesPath();
            expect(preferencesPath).toBe(mockPreferencesPath);
        });
    });

    describe('saveGlobalPreferences', () => {
        it('should save preferences to YAML file', async () => {
            await saveGlobalPreferences(samplePreferences);

            // Verify file was created
            expect(
                await fs.access(mockPreferencesPath).then(
                    () => true,
                    () => false
                )
            ).toBe(true);

            // Verify content is valid YAML with correct values
            const fileContent = await fs.readFile(mockPreferencesPath, 'utf-8');
            expect(fileContent).toContain('provider: anthropic');
            expect(fileContent).toContain('model: claude-4-sonnet-20250514');
            expect(fileContent).toContain('apiKey: $ANTHROPIC_API_KEY');
            expect(fileContent).toContain('defaultAgent: test-agent');
            expect(fileContent).toContain('completed: true');
        });

        it('should create directory structure if it does not exist', async () => {
            // Use a nested path that doesn't exist
            const nestedDir = path.join(tempDir, 'nested', 'deep');
            const nestedPreferencesPath = path.join(nestedDir, 'preferences.yml');

            // Restore the original mock and create new one for this test
            vi.restoreAllMocks();
            vi.spyOn(pathUtils, 'getDextoGlobalPath').mockImplementation(
                (type: string, filename?: string) => {
                    if (type === 'preferences.yml' || filename === 'preferences.yml') {
                        return nestedPreferencesPath;
                    }
                    return nestedDir;
                }
            );

            await saveGlobalPreferences(samplePreferences);

            // Directory should be created
            expect(
                await fs.access(nestedPreferencesPath).then(
                    () => true,
                    () => false
                )
            ).toBe(true);
        });

        it('should format YAML with proper indentation and line width', async () => {
            const preferencesWithLongValues = {
                ...samplePreferences,
                llm: {
                    provider: 'openai' as const,
                    model: 'gpt-4o-audio-preview', // Valid long model name
                    apiKey: '$OPENAI_API_KEY',
                },
            };

            await saveGlobalPreferences(preferencesWithLongValues);
            const fileContent = await fs.readFile(mockPreferencesPath, 'utf-8');

            // Should be properly formatted
            expect(fileContent).toMatch(/^llm:/m);
            expect(fileContent).toMatch(/^ {2}provider:/m);
            expect(fileContent).toMatch(/^defaults:/m);
        });

        it('should throw validation error for invalid preferences', async () => {
            const invalidPreferences = {
                llm: {
                    provider: 'invalid-provider', // Invalid provider
                    model: 'some-model',
                    apiKey: '$API_KEY',
                },
                defaults: {
                    defaultAgent: 'test-agent', // Required field
                },
                setup: {
                    completed: true, // Required field
                },
            } as any;

            await expect(saveGlobalPreferences(invalidPreferences)).rejects.toThrow(
                expect.objectContaining({
                    issues: expect.arrayContaining([
                        expect.objectContaining({
                            code: PreferenceErrorCode.VALIDATION_ERROR,
                            scope: 'preference',
                            type: ErrorType.USER,
                        }),
                    ]),
                })
            );
        });
    });

    describe('loadGlobalPreferences', () => {
        beforeEach(async () => {
            // Create preferences file for loading tests
            await saveGlobalPreferences(samplePreferences);
        });

        it('should load preferences from YAML file', async () => {
            const loadedPreferences = await loadGlobalPreferences();

            expect(loadedPreferences).toEqual(samplePreferences);
        });

        it('should validate loaded preferences against schema', async () => {
            const loadedPreferences = await loadGlobalPreferences();

            // Should have all required fields
            expect(loadedPreferences.llm.provider).toBeDefined();
            expect(loadedPreferences.llm.model).toBeDefined();
            expect(loadedPreferences.llm.apiKey).toBeDefined();
            expect(loadedPreferences.defaults.defaultAgent).toBeDefined();
            expect(loadedPreferences.setup.completed).toBeDefined();
        });

        it('should throw file not found error when preferences file does not exist', async () => {
            // Remove the preferences file
            await fs.unlink(mockPreferencesPath);

            await expect(loadGlobalPreferences()).rejects.toThrow(
                expect.objectContaining({
                    code: PreferenceErrorCode.FILE_NOT_FOUND,
                    scope: 'preference',
                    type: ErrorType.USER,
                })
            );
        });

        it('should throw validation error for invalid YAML content', async () => {
            // Write invalid YAML
            await fs.writeFile(mockPreferencesPath, 'invalid: yaml: [}', 'utf-8');

            await expect(loadGlobalPreferences()).rejects.toThrow(
                expect.objectContaining({
                    code: PreferenceErrorCode.FILE_READ_ERROR,
                    scope: 'preference',
                    type: ErrorType.SYSTEM,
                })
            );
        });

        it('should throw validation error for preferences with missing required fields', async () => {
            const incompletePreferences = {
                llm: {
                    provider: 'openai',
                    // Missing model and apiKey
                },
                // Missing defaults and setup sections
            };

            await fs.writeFile(mockPreferencesPath, JSON.stringify(incompletePreferences), 'utf-8');

            await expect(loadGlobalPreferences()).rejects.toThrow(
                expect.objectContaining({
                    issues: expect.arrayContaining([
                        expect.objectContaining({
                            code: PreferenceErrorCode.VALIDATION_ERROR,
                            scope: 'preference',
                            type: ErrorType.USER,
                        }),
                    ]),
                })
            );
        });

        it('should throw validation error for preferences with invalid provider', async () => {
            const yamlContent = `llm:
  provider: invalid-provider
  model: some-model
  apiKey: $API_KEY
defaults:
  defaultAgent: test-agent
setup:
  completed: true`;

            await fs.writeFile(mockPreferencesPath, yamlContent, 'utf-8');

            await expect(loadGlobalPreferences()).rejects.toThrow(
                expect.objectContaining({
                    issues: expect.arrayContaining([
                        expect.objectContaining({
                            code: PreferenceErrorCode.VALIDATION_ERROR,
                            scope: 'preference',
                            type: ErrorType.USER,
                        }),
                    ]),
                })
            );
        });
    });

    describe('createInitialPreferences', () => {
        it('should create preferences with provided values', () => {
            const preferences = createInitialPreferences({
                provider: 'openai',
                model: 'gpt-5',
                apiKeyVar: 'OPENAI_API_KEY',
                defaultAgent: 'my-agent',
            });

            expect(preferences).toEqual({
                llm: {
                    provider: 'openai',
                    model: 'gpt-5',
                    apiKey: '$OPENAI_API_KEY',
                },
                defaults: {
                    defaultAgent: 'my-agent',
                    defaultMode: 'web',
                },
                setup: {
                    completed: true,
                    apiKeyPending: false,
                    baseURLPending: false,
                },
                sounds: {
                    enabled: true,
                    onApprovalRequired: true,
                    onTaskComplete: true,
                },
                preferDextoCredits: true,
            });
        });

        it('should use default agent name when not provided', () => {
            const preferences = createInitialPreferences({
                provider: 'anthropic',
                model: 'claude-4-sonnet-20250514',
                apiKeyVar: 'ANTHROPIC_API_KEY',
            });

            expect(preferences.defaults.defaultAgent).toBe('coding-agent');
        });

        it('should format API key with $ prefix', () => {
            const preferences = createInitialPreferences({
                provider: 'google',
                model: 'gemini-pro',
                apiKeyVar: 'GOOGLE_API_KEY',
            });

            expect(preferences.llm.apiKey).toBe('$GOOGLE_API_KEY');
        });

        it('should populate sounds with defaults', () => {
            const preferences = createInitialPreferences({
                provider: 'google',
                model: 'gemini-pro',
            });

            expect(preferences.sounds).toEqual({
                enabled: true,
                onApprovalRequired: true,
                onTaskComplete: true,
            });
        });

        it('should allow custom sounds configuration', () => {
            const preferences = createInitialPreferences({
                provider: 'google',
                model: 'gemini-pro',
                sounds: {
                    enabled: true,
                    onApprovalRequired: false,
                },
            });

            expect(preferences.sounds).toEqual({
                enabled: true,
                onApprovalRequired: false,
                onTaskComplete: true,
            });
        });
    });

    describe('updateGlobalPreferences', () => {
        beforeEach(async () => {
            // Create initial preferences file
            await saveGlobalPreferences(samplePreferences);
        });

        it('should replace complete sections while preserving others', async () => {
            const updates: Partial<GlobalPreferences> = {
                llm: {
                    provider: 'openai',
                    model: 'gpt-5',
                    apiKey: '$OPENAI_API_KEY',
                },
            };

            const updatedPreferences = await updateGlobalPreferences(updates);

            // LLM section should be completely replaced
            expect(updatedPreferences.llm.provider).toBe('openai');
            expect(updatedPreferences.llm.model).toBe('gpt-5');
            expect(updatedPreferences.llm.apiKey).toBe('$OPENAI_API_KEY');

            // Other sections should remain unchanged
            expect(updatedPreferences.defaults.defaultAgent).toBe('test-agent'); // Preserved from original
            expect(updatedPreferences.setup.completed).toBe(true); // Preserved from original
        });

        it('should allow partial updates for defaults section', async () => {
            // Update only the defaults section
            const updates = {
                defaults: {
                    defaultAgent: 'new-default-agent',
                },
            };

            const updatedPreferences = await updateGlobalPreferences(updates);

            // Defaults section should be updated
            expect(updatedPreferences.defaults.defaultAgent).toBe('new-default-agent');
            // Other sections should remain unchanged
            expect(updatedPreferences.llm.provider).toBe('anthropic'); // Preserved
            expect(updatedPreferences.setup.completed).toBe(true); // Preserved
        });

        it('should allow partial updates for setup section', async () => {
            // Update only the setup section
            const updates = {
                setup: {
                    completed: false,
                },
            };

            const updatedPreferences = await updateGlobalPreferences(updates);

            // Setup section should be updated
            expect(updatedPreferences.setup.completed).toBe(false);
            // Other sections should remain unchanged
            expect(updatedPreferences.llm.provider).toBe('anthropic'); // Preserved
            expect(updatedPreferences.defaults.defaultAgent).toBe('test-agent'); // Preserved
        });

        it('should save updated preferences to file', async () => {
            const updates = {
                llm: {
                    provider: 'anthropic' as const,
                    model: 'claude-4-opus-20250514',
                    apiKey: '$ANTHROPIC_API_KEY',
                },
            };

            await updateGlobalPreferences(updates);

            // Verify file was updated
            const fileContent = await fs.readFile(mockPreferencesPath, 'utf-8');
            expect(fileContent).toContain('model: claude-4-opus-20250514');
        });

        it('should throw validation error for invalid merged preferences', async () => {
            const invalidUpdates = {
                llm: {
                    provider: 'invalid-provider' as any,
                    model: 'some-model',
                    apiKey: '$API_KEY',
                },
            };

            await expect(updateGlobalPreferences(invalidUpdates)).rejects.toThrow(
                expect.objectContaining({
                    issues: expect.arrayContaining([
                        expect.objectContaining({
                            code: PreferenceErrorCode.VALIDATION_ERROR,
                            scope: 'preference',
                            type: ErrorType.USER,
                        }),
                    ]),
                })
            );
        });

        it('should handle multiple nested updates', async () => {
            const updates = {
                llm: {
                    provider: 'google' as const,
                    model: 'gemini-2.0-flash',
                    apiKey: '$GOOGLE_API_KEY',
                },
                defaults: {
                    defaultAgent: 'updated-agent',
                },
                setup: {
                    completed: false,
                },
            };

            const updatedPreferences = await updateGlobalPreferences(updates);

            expect(updatedPreferences.llm.provider).toBe('google');
            expect(updatedPreferences.llm.model).toBe('gemini-2.0-flash');
            expect(updatedPreferences.defaults.defaultAgent).toBe('updated-agent');
            expect(updatedPreferences.setup.completed).toBe(false);
        });

        it('should return the updated preferences object', async () => {
            const updates = {
                llm: {
                    provider: 'groq' as const,
                    model: 'llama-3.3-70b-versatile', // Valid groq model
                    apiKey: '$GROQ_API_KEY',
                },
            };

            const result = await updateGlobalPreferences(updates);

            expect(result.llm.provider).toBe('groq');
            expect(result.llm.model).toBe('llama-3.3-70b-versatile');
            expect(result).toMatchObject({
                llm: expect.objectContaining({
                    provider: 'groq',
                }),
                defaults: expect.any(Object),
                setup: expect.any(Object),
            });
        });
    });
});
