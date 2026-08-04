import { describe, expect, it } from 'vitest';

import { createLLMConfigSchema } from './index.browser.js';

describe('browser-safe core exports', () => {
    it('exports the registry-aware LLM config schema factory', () => {
        expect(createLLMConfigSchema).toEqual(expect.any(Function));
    });
});
