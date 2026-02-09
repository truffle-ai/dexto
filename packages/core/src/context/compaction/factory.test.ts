import { describe, expect, it, vi } from 'vitest';
import { createCompactionStrategy } from './factory.js';
import { createMockLogger } from '../../logger/v2/test-utils.js';
import { ContextErrorCode } from '../error-codes.js';
import type { LanguageModel } from 'ai';

function createMockModel(): LanguageModel {
    return {
        modelId: 'test-model',
        provider: 'test-provider',
        specificationVersion: 'v1',
        doStream: vi.fn(),
        doGenerate: vi.fn(),
    } as unknown as LanguageModel;
}

describe('createCompactionStrategy', () => {
    it('returns null when disabled', async () => {
        const logger = createMockLogger();
        const result = await createCompactionStrategy({ type: 'noop', enabled: false }, { logger });
        expect(result).toBeNull();
    });

    it('creates noop strategy without LLM', async () => {
        const logger = createMockLogger();
        const result = await createCompactionStrategy({ type: 'noop' }, { logger });
        expect(result?.name).toBe('noop');
    });

    it('throws when strategy requires LLM but none provided', async () => {
        const logger = createMockLogger();
        await expect(
            createCompactionStrategy({ type: 'reactive-overflow' }, { logger })
        ).rejects.toMatchObject({
            code: ContextErrorCode.COMPACTION_MISSING_LLM,
        });
    });

    it('creates reactive-overflow strategy when model is provided', async () => {
        const logger = createMockLogger();
        const result = await createCompactionStrategy(
            { type: 'reactive-overflow' },
            { logger, model: createMockModel() }
        );
        expect(result?.name).toBe('reactive-overflow');
    });
});
