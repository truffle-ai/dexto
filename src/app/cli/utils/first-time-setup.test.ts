import { describe, it, expect, vi } from 'vitest';
import { isFirstTimeUserScenario, showProviderPicker } from './first-time-setup.js';
import { getBundledConfigPath, getUserConfigPath } from '@core/utils/path.js';

// Mock @clack/prompts to avoid interactive prompts in tests
vi.mock('@clack/prompts', () => ({
    select: vi.fn(),
    isCancel: vi.fn(),
}));

describe('First-time setup utilities', () => {
    describe('isFirstTimeUserScenario', () => {
        it('returns true when using actual bundled config path', () => {
            // Get the real bundled config path
            const bundledPath = getBundledConfigPath();
            expect(isFirstTimeUserScenario(bundledPath)).toBe(true);
        });

        it('returns false when using user config path', () => {
            const userPath = getUserConfigPath();
            expect(isFirstTimeUserScenario(userPath)).toBe(false);
        });

        it('returns false when using any other config path', () => {
            const projectPath = '/some/project/agents/agent.yml';
            expect(isFirstTimeUserScenario(projectPath)).toBe(false);
        });
    });

    describe('showProviderPicker', () => {
        it('returns selected provider', async () => {
            const mockPrompts = await import('@clack/prompts');
            vi.mocked(mockPrompts.select).mockResolvedValue('google');
            vi.mocked(mockPrompts.isCancel).mockReturnValue(false);

            const result = await showProviderPicker();
            expect(result).toBe('google');

            // Verify the select was called with proper options
            expect(mockPrompts.select).toHaveBeenCalledWith({
                message: 'Choose your AI provider',
                options: expect.arrayContaining([
                    expect.objectContaining({
                        value: 'google',
                        label: expect.stringContaining('Google Gemini'),
                    }),
                    expect.objectContaining({
                        value: 'groq',
                        label: expect.stringContaining('Groq'),
                    }),
                    expect.objectContaining({
                        value: 'openai',
                        label: expect.stringContaining('OpenAI'),
                    }),
                    expect.objectContaining({
                        value: 'anthropic',
                        label: expect.stringContaining('Anthropic'),
                    }),
                ]),
            });
        });

        it('returns null when cancelled', async () => {
            const mockPrompts = await import('@clack/prompts');
            const cancelSymbol = Symbol('cancelled');
            vi.mocked(mockPrompts.select).mockResolvedValue(cancelSymbol);
            vi.mocked(mockPrompts.isCancel).mockReturnValue(true);

            const result = await showProviderPicker();
            expect(result).toBe(null);
        });
    });

    // Note: copyBundledConfigWithProvider and handleFirstTimeSetup are complex integration functions
    // that involve file I/O and external dependencies. These would be better tested in integration tests.
});
