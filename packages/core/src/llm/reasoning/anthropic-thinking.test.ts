import { describe, expect, it } from 'vitest';
import {
    isAnthropicAdaptiveThinkingModel,
    supportsAnthropicInterleavedThinking,
} from './anthropic-thinking.js';

describe('anthropic-thinking', () => {
    it('does not treat date suffixes as minor versions', () => {
        expect(isAnthropicAdaptiveThinkingModel('claude-opus-4-20250514')).toBe(false);
        expect(isAnthropicAdaptiveThinkingModel('anthropic/claude-opus-4-20250514')).toBe(false);
        expect(supportsAnthropicInterleavedThinking('claude-opus-4-20250514')).toBe(true);
    });
});
