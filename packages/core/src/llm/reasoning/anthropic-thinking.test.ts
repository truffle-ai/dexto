import { describe, expect, it } from 'vitest';
import {
    isAnthropicAdaptiveThinkingModel,
    isAnthropicOpusAdaptiveThinkingModel,
    supportsAnthropicInterleavedThinking,
} from './anthropic-thinking.js';

describe('anthropic-thinking', () => {
    it('detects adaptive thinking for Claude >= 4.6 across ID formats', () => {
        const adaptiveCases = [
            'claude-opus-4-6',
            'anthropic/claude-sonnet-4.6',
            'anthropic/claude-4.6-opus',
            'claude-4-6-sonnet@20250219',
            'anthropic.claude-haiku-5-0-20260101-v1:0',
        ];

        for (const model of adaptiveCases) {
            expect(isAnthropicAdaptiveThinkingModel(model)).toBe(true);
        }
    });

    it('does not treat pre-4.6 models as adaptive', () => {
        const nonAdaptiveCases = [
            'claude-opus-4-5',
            'anthropic/claude-sonnet-4.5',
            'claude-3-7-sonnet@20250219',
            'claude-opus-4-20250514',
            'gpt-5.2',
        ];

        for (const model of nonAdaptiveCases) {
            expect(isAnthropicAdaptiveThinkingModel(model)).toBe(false);
        }
    });

    it('detects Opus max-effort support only for Opus >= 4.6', () => {
        const opusMaxCases = [
            'claude-opus-4-6',
            'anthropic/claude-opus-4.6',
            'anthropic/claude-4.6-opus',
            'claude-opus-5',
        ];

        for (const model of opusMaxCases) {
            expect(isAnthropicOpusAdaptiveThinkingModel(model)).toBe(true);
        }
    });

    it('does not detect Opus max-effort support for non-Opus or older Opus models', () => {
        const nonOpusMaxCases = [
            'claude-sonnet-4-6',
            'claude-opus-4-5',
            'claude-4-6-sonnet@20250219',
            'claude-opus-4-20250514',
        ];

        for (const model of nonOpusMaxCases) {
            expect(isAnthropicOpusAdaptiveThinkingModel(model)).toBe(false);
        }
    });

    it('detects interleaved thinking for Claude 4+ and rejects older/invalid models', () => {
        const interleavedCases = [
            'claude-opus-4-20250514',
            'anthropic/claude-sonnet-4.6',
            'anthropic/claude-4.5-opus',
            'anthropic.claude-haiku-5-0-20260101-v1:0',
        ];
        const notInterleavedCases = ['claude-3-7-sonnet@20250219', 'claude-2', 'gpt-5.2'];

        for (const model of interleavedCases) {
            expect(supportsAnthropicInterleavedThinking(model)).toBe(true);
        }

        for (const model of notInterleavedCases) {
            expect(supportsAnthropicInterleavedThinking(model)).toBe(false);
        }
    });
});
