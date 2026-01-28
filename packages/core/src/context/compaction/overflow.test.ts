import { describe, it, expect } from 'vitest';
import { isOverflow, getCompactionTarget, type ModelLimits } from './overflow.js';
import type { TokenUsage } from '../../llm/types.js';

describe('isOverflow', () => {
    describe('basic overflow detection', () => {
        it('should return false when input tokens are well below limit', () => {
            const tokens: TokenUsage = {
                inputTokens: 50000,
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(false);
        });

        it('should return false when input tokens are just below context window (with 100% threshold)', () => {
            const tokens: TokenUsage = {
                inputTokens: 199999,
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
            };

            // Explicitly use 1.0 threshold to test full capacity boundary
            const result = isOverflow(tokens, modelLimits, 1.0);

            expect(result).toBe(false);
        });

        it('should return true when input tokens exceed context window', () => {
            const tokens: TokenUsage = {
                inputTokens: 200001,
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(true);
        });

        it('should return false when input tokens exactly equal context window (with 100% threshold)', () => {
            // Edge case: exactly at the limit should NOT trigger overflow
            // (inputTokens > effectiveLimit, not >=)
            const tokens: TokenUsage = {
                inputTokens: 200000,
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
            };

            // Explicitly use 1.0 threshold to test full capacity boundary
            const result = isOverflow(tokens, modelLimits, 1.0);

            expect(result).toBe(false);
        });
    });

    describe('handling missing inputTokens', () => {
        it('should default to 0 when inputTokens is undefined', () => {
            const tokens: TokenUsage = {
                // inputTokens is undefined
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(false);
        });
    });

    describe('small context windows', () => {
        it('should correctly detect overflow for small context windows', () => {
            const tokens: TokenUsage = {
                inputTokens: 8193,
            };
            const modelLimits: ModelLimits = {
                contextWindow: 8192,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(true);
        });
    });

    describe('configurable context window (via maxContextTokens override)', () => {
        it('should work with reduced context window from config', () => {
            // User configured maxContextTokens: 50000
            // Even though model supports 200K, we treat it as 50K
            const tokens: TokenUsage = {
                inputTokens: 50001,
            };
            // The effective context window passed would be 50000
            const modelLimits: ModelLimits = {
                contextWindow: 50000,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(true);
        });
    });

    describe('thresholdPercent parameter', () => {
        it('should trigger overflow earlier when thresholdPercent is less than 1.0', () => {
            // contextWindow: 200000
            // With threshold 0.9: effectiveLimit = floor(200000 * 0.9) = 180000
            const tokens: TokenUsage = {
                inputTokens: 180001, // Just over 90% threshold
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
            };

            // Without threshold (or threshold=1.0), this would NOT overflow
            expect(isOverflow(tokens, modelLimits, 1.0)).toBe(false);
            // With threshold=0.9, this SHOULD overflow
            expect(isOverflow(tokens, modelLimits, 0.9)).toBe(true);
        });

        it('should use default threshold of 0.9 when not specified', () => {
            const tokens: TokenUsage = {
                inputTokens: 180000, // 90% of context window
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
            };

            // Default should be same as explicit 0.9
            expect(isOverflow(tokens, modelLimits)).toBe(isOverflow(tokens, modelLimits, 0.9));
        });

        it('should handle threshold of 0.5 (50%)', () => {
            // contextWindow: 200000
            // With threshold 0.5: effectiveLimit = floor(200000 * 0.5) = 100000
            const tokens: TokenUsage = {
                inputTokens: 100001,
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
            };

            expect(isOverflow(tokens, modelLimits, 0.5)).toBe(true);
            expect(isOverflow(tokens, modelLimits, 1.0)).toBe(false);
        });

        it('should floor the effective limit', () => {
            // contextWindow: 100, thresholdPercent: 0.9
            // effectiveLimit = floor(100 * 0.9) = 90
            const modelLimits: ModelLimits = {
                contextWindow: 100,
            };

            // At exactly 90 tokens, should NOT overflow
            expect(isOverflow({ inputTokens: 90 }, modelLimits, 0.9)).toBe(false);
            // At 91 tokens, SHOULD overflow
            expect(isOverflow({ inputTokens: 91 }, modelLimits, 0.9)).toBe(true);
        });
    });
});

describe('getCompactionTarget', () => {
    describe('default target percentage (70%)', () => {
        it('should return 70% of context window by default', () => {
            // target = floor(200000 * 0.7) = 140000
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
            };

            const target = getCompactionTarget(modelLimits);

            expect(target).toBe(140000);
        });
    });

    describe('custom target percentage', () => {
        it('should return correct target for 50% percentage', () => {
            // target = floor(200000 * 0.5) = 100000
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
            };

            const target = getCompactionTarget(modelLimits, 0.5);

            expect(target).toBe(100000);
        });

        it('should return correct target for 90% percentage', () => {
            // target = floor(200000 * 0.9) = 180000
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
            };

            const target = getCompactionTarget(modelLimits, 0.9);

            expect(target).toBe(180000);
        });
    });

    describe('floor behavior', () => {
        it('should floor the result to avoid fractional tokens', () => {
            // target = floor(100000 * 0.33) = 33000
            const modelLimits: ModelLimits = {
                contextWindow: 100000,
            };

            const target = getCompactionTarget(modelLimits, 0.33);

            expect(Number.isInteger(target)).toBe(true);
            expect(target).toBe(33000);
        });
    });

    describe('small context windows', () => {
        it('should work correctly with small context windows', () => {
            // target = floor(8192 * 0.7) = 5734
            const modelLimits: ModelLimits = {
                contextWindow: 8192,
            };

            const target = getCompactionTarget(modelLimits);

            expect(target).toBe(5734);
        });
    });
});
