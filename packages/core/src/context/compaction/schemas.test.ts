import { describe, it, expect } from 'vitest';
import {
    CompactionConfigSchema,
    DEFAULT_COMPACTION_CONFIG,
    type CompactionConfigInput,
} from './schemas.js';

describe('CompactionConfigSchema', () => {
    describe('basic validation', () => {
        it('should accept valid minimal config', () => {
            const input = {
                type: 'reactive-overflow',
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.type).toBe('reactive-overflow');
                expect(result.data.enabled).toBe(true);
                expect(result.data.thresholdPercent).toBe(0.9);
            }
        });

        it('should accept config with enabled explicitly set', () => {
            const input = {
                type: 'reactive-overflow',
                enabled: false,
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.enabled).toBe(false);
            }
        });

        it('should reject config without type', () => {
            const input = {
                enabled: true,
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(false);
        });
    });

    describe('maxContextTokens', () => {
        it('should accept positive maxContextTokens', () => {
            const input = {
                type: 'reactive-overflow',
                maxContextTokens: 50000,
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.maxContextTokens).toBe(50000);
            }
        });

        it('should reject zero maxContextTokens', () => {
            const input = {
                type: 'reactive-overflow',
                maxContextTokens: 0,
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(false);
        });

        it('should reject negative maxContextTokens', () => {
            const input = {
                type: 'reactive-overflow',
                maxContextTokens: -1000,
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(false);
        });

        it('should allow omitting maxContextTokens', () => {
            const input = {
                type: 'reactive-overflow',
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.maxContextTokens).toBeUndefined();
            }
        });
    });

    describe('thresholdPercent', () => {
        it('should default thresholdPercent to 0.9', () => {
            const input = {
                type: 'reactive-overflow',
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.thresholdPercent).toBe(0.9);
            }
        });

        it('should accept thresholdPercent of 0.8 (80%)', () => {
            const input = {
                type: 'reactive-overflow',
                thresholdPercent: 0.8,
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.thresholdPercent).toBe(0.8);
            }
        });

        it('should accept thresholdPercent of 0.1 (10% - minimum)', () => {
            const input = {
                type: 'reactive-overflow',
                thresholdPercent: 0.1,
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.thresholdPercent).toBe(0.1);
            }
        });

        it('should accept thresholdPercent of 1.0 (100% - maximum)', () => {
            const input = {
                type: 'reactive-overflow',
                thresholdPercent: 1.0,
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.thresholdPercent).toBe(1.0);
            }
        });

        it('should reject thresholdPercent below 0.1', () => {
            const input = {
                type: 'reactive-overflow',
                thresholdPercent: 0.05,
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(false);
        });

        it('should reject thresholdPercent above 1.0', () => {
            const input = {
                type: 'reactive-overflow',
                thresholdPercent: 1.5,
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(false);
        });

        it('should reject thresholdPercent of 0', () => {
            const input = {
                type: 'reactive-overflow',
                thresholdPercent: 0,
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(false);
        });
    });

    describe('combined configuration', () => {
        it('should accept full config with all fields', () => {
            const input = {
                type: 'reactive-overflow',
                enabled: true,
                maxContextTokens: 100000,
                thresholdPercent: 0.75,
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.type).toBe('reactive-overflow');
                expect(result.data.enabled).toBe(true);
                expect(result.data.maxContextTokens).toBe(100000);
                expect(result.data.thresholdPercent).toBe(0.75);
            }
        });

        it('should allow additional passthrough fields for provider-specific config', () => {
            const input = {
                type: 'reactive-overflow',
                enabled: true,
                maxSummaryTokens: 2000,
                preserveLastNTurns: 3,
            };

            const result = CompactionConfigSchema.safeParse(input);

            expect(result.success).toBe(true);
            if (result.success) {
                // Passthrough fields should be preserved
                expect((result.data as Record<string, unknown>).maxSummaryTokens).toBe(2000);
                expect((result.data as Record<string, unknown>).preserveLastNTurns).toBe(3);
            }
        });
    });

    describe('DEFAULT_COMPACTION_CONFIG', () => {
        it('should have expected default values', () => {
            expect(DEFAULT_COMPACTION_CONFIG.type).toBe('reactive-overflow');
            expect(DEFAULT_COMPACTION_CONFIG.enabled).toBe(true);
            expect(DEFAULT_COMPACTION_CONFIG.thresholdPercent).toBe(0.9);
        });

        it('should validate successfully', () => {
            const result = CompactionConfigSchema.safeParse(DEFAULT_COMPACTION_CONFIG);

            expect(result.success).toBe(true);
        });
    });

    describe('type inference', () => {
        it('should produce correct output type', () => {
            const config: CompactionConfigInput = {
                type: 'reactive-overflow',
                enabled: true,
                maxContextTokens: 50000,
                thresholdPercent: 0.9,
            };

            // Type checking - these should compile without errors
            const type: string = config.type;
            const enabled: boolean = config.enabled;
            const maxTokens: number | undefined = config.maxContextTokens;
            const threshold: number = config.thresholdPercent;

            expect(type).toBe('reactive-overflow');
            expect(enabled).toBe(true);
            expect(maxTokens).toBe(50000);
            expect(threshold).toBe(0.9);
        });
    });
});
