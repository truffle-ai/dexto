import { describe, it, expect, vi } from 'vitest';
import { isFirstTimeUserScenario, showProviderPicker } from './first-time-setup.js';

// Mock @clack/prompts to avoid interactive prompts in tests
vi.mock('@clack/prompts', () => ({
    select: vi.fn(),
    isCancel: vi.fn(),
}));

// Mock path utilities to control the test environment
vi.mock('@core/utils/path.js', async () => {
    const actual = await vi.importActual('@core/utils/path.js');
    return {
        ...actual,
        isDextoSourceCode: vi.fn(),
        isUsingBundledConfig: vi.fn(),
    };
});

describe('First-time setup utilities', () => {
    describe('isFirstTimeUserScenario', () => {
        it('returns true when using bundled config and not in dexto source', async () => {
            const { isDextoSourceCode, isUsingBundledConfig } = await import('@core/utils/path.js');
            vi.mocked(isDextoSourceCode).mockReturnValue(false);
            vi.mocked(isUsingBundledConfig).mockReturnValue(true);

            const result = isFirstTimeUserScenario('/some/bundled/config/path');
            expect(result).toBe(true);
        });

        it('returns false when in dexto source code (even with bundled config)', async () => {
            const { isDextoSourceCode, isUsingBundledConfig } = await import('@core/utils/path.js');
            vi.mocked(isDextoSourceCode).mockReturnValue(true);
            vi.mocked(isUsingBundledConfig).mockReturnValue(true);

            const result = isFirstTimeUserScenario('/dexto/source/agents/agent.yml');
            expect(result).toBe(false);
        });

        it('returns false when not using bundled config', async () => {
            const { isDextoSourceCode, isUsingBundledConfig } = await import('@core/utils/path.js');
            vi.mocked(isDextoSourceCode).mockReturnValue(false);
            vi.mocked(isUsingBundledConfig).mockReturnValue(false);

            const result = isFirstTimeUserScenario('/user/config/path');
            expect(result).toBe(false);
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
