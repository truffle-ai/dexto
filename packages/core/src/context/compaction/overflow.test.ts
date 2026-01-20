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
                maxOutput: 8192,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(false);
        });

        it('should return false when input tokens are just below usable limit', () => {
            // contextWindow: 200000, maxOutput: 16000 (capped)
            // usableTokens = 200000 - 16000 = 184000
            const tokens: TokenUsage = {
                inputTokens: 183999,
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
                maxOutput: 20000,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(false);
        });

        it('should return true when input tokens exceed usable limit', () => {
            // contextWindow: 200000, maxOutput: 16000 (capped)
            // usableTokens = 200000 - 16000 = 184000
            const tokens: TokenUsage = {
                inputTokens: 184001,
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
                maxOutput: 20000,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(true);
        });

        it('should return false when input tokens exactly equal usable limit', () => {
            // Edge case: exactly at the limit should NOT trigger overflow
            // (inputTokens > usableTokens, not >=)
            const tokens: TokenUsage = {
                inputTokens: 184000,
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
                maxOutput: 16000,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(false);
        });
    });

    describe('output buffer capping', () => {
        it('should cap output buffer at 16000 when maxOutput is higher', () => {
            // maxOutput is 50000 but should be capped at 16000
            // usableTokens = 200000 - 16000 = 184000
            const tokens: TokenUsage = {
                inputTokens: 184001,
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
                maxOutput: 50000,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(true);
        });

        it('should use actual maxOutput when below 16000', () => {
            // maxOutput is 4096, so usableTokens = 200000 - 4096 = 195904
            const tokens: TokenUsage = {
                inputTokens: 195905,
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
                maxOutput: 4096,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(true);
        });
    });

    describe('handling missing inputTokens', () => {
        it('should default to 0 when inputTokens is undefined', () => {
            const tokens: TokenUsage = {
                // inputTokens is undefined
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
                maxOutput: 8192,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(false);
        });
    });

    describe('small context windows', () => {
        it('should correctly detect overflow for small context windows', () => {
            // 8K context window model
            // usableTokens = 8192 - 4096 = 4096
            const tokens: TokenUsage = {
                inputTokens: 4097,
            };
            const modelLimits: ModelLimits = {
                contextWindow: 8192,
                maxOutput: 4096,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(true);
        });
    });

    describe('configurable context window (via maxContextTokens override)', () => {
        it('should work with reduced context window from config', () => {
            // User configured maxContextTokens: 50000
            // Even though model supports 200K, we treat it as 50K
            // usableTokens = 50000 - 16000 = 34000
            const tokens: TokenUsage = {
                inputTokens: 34001,
            };
            // The effective context window passed would be 50000
            const modelLimits: ModelLimits = {
                contextWindow: 50000,
                maxOutput: 16000,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(true);
        });

        it('should work with threshold percent applied', () => {
            // User configured thresholdPercent: 0.8
            // Model: 200K context, but effective is 200K * 0.8 = 160K
            // usableTokens = 160000 - 16000 = 144000
            const tokens: TokenUsage = {
                inputTokens: 144001,
            };
            // The effective context window passed would be 160000 (after thresholdPercent)
            const modelLimits: ModelLimits = {
                contextWindow: 160000,
                maxOutput: 16000,
            };

            const result = isOverflow(tokens, modelLimits);

            expect(result).toBe(true);
        });
    });

    describe('thresholdPercent parameter', () => {
        it('should trigger overflow earlier when thresholdPercent is less than 1.0', () => {
            // contextWindow: 200000, maxOutput: 16000
            // usableTokens = 200000 - 16000 = 184000
            // With threshold 0.9: effectiveLimit = 184000 * 0.9 = 165600
            const tokens: TokenUsage = {
                inputTokens: 165601, // Just over 90% threshold
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
                maxOutput: 16000,
            };

            // Without threshold (or threshold=1.0), this would NOT overflow
            expect(isOverflow(tokens, modelLimits, 1.0)).toBe(false);
            // With threshold=0.9, this SHOULD overflow
            expect(isOverflow(tokens, modelLimits, 0.9)).toBe(true);
        });

        it('should use default threshold of 1.0 when not specified', () => {
            const tokens: TokenUsage = {
                inputTokens: 165600, // 90% of usable
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
                maxOutput: 16000,
            };

            // Default should be same as explicit 1.0
            expect(isOverflow(tokens, modelLimits)).toBe(isOverflow(tokens, modelLimits, 1.0));
        });

        it('should handle threshold of 0.5 (50%)', () => {
            // usableTokens = 200000 - 16000 = 184000
            // With threshold 0.5: effectiveLimit = 184000 * 0.5 = 92000
            const tokens: TokenUsage = {
                inputTokens: 92001,
            };
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
                maxOutput: 16000,
            };

            expect(isOverflow(tokens, modelLimits, 0.5)).toBe(true);
            expect(isOverflow(tokens, modelLimits, 1.0)).toBe(false);
        });
    });
});

describe('getCompactionTarget', () => {
    describe('default target percentage (70%)', () => {
        it('should return 70% of usable context by default', () => {
            // usableTokens = 200000 - 16000 = 184000
            // target = Math.floor(184000 * 0.7) = 128799 (due to floating point)
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
                maxOutput: 20000,
            };

            const target = getCompactionTarget(modelLimits);

            // 184000 * 0.7 = 128799.99999... which floors to 128799
            expect(target).toBe(128799);
        });
    });

    describe('custom target percentage', () => {
        it('should return correct target for 50% percentage', () => {
            // usableTokens = 200000 - 16000 = 184000
            // target = 184000 * 0.5 = 92000
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
                maxOutput: 20000,
            };

            const target = getCompactionTarget(modelLimits, 0.5);

            expect(target).toBe(92000);
        });

        it('should return correct target for 90% percentage', () => {
            // usableTokens = 200000 - 16000 = 184000
            // target = 184000 * 0.9 = 165600
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
                maxOutput: 20000,
            };

            const target = getCompactionTarget(modelLimits, 0.9);

            expect(target).toBe(165600);
        });
    });

    describe('output buffer capping for target calculation', () => {
        it('should cap output buffer at 16000 when calculating target', () => {
            // maxOutput 50000 capped to 16000
            // usableTokens = 200000 - 16000 = 184000
            // target = Math.floor(184000 * 0.7) = 128799 (due to floating point)
            const modelLimits: ModelLimits = {
                contextWindow: 200000,
                maxOutput: 50000,
            };

            const target = getCompactionTarget(modelLimits);

            // 184000 * 0.7 = 128799.99999... which floors to 128799
            expect(target).toBe(128799);
        });
    });

    describe('floor behavior', () => {
        it('should floor the result to avoid fractional tokens', () => {
            // usableTokens = 100000 - 16000 = 84000
            // target = 84000 * 0.33 = 27720
            const modelLimits: ModelLimits = {
                contextWindow: 100000,
                maxOutput: 20000,
            };

            const target = getCompactionTarget(modelLimits, 0.33);

            expect(Number.isInteger(target)).toBe(true);
            expect(target).toBe(27720);
        });
    });
});
