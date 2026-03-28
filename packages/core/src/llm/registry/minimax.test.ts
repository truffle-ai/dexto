import { describe, it, expect, vi } from 'vitest';
import {
    LLM_REGISTRY,
    getDefaultModelForProvider,
    isValidProviderModel,
    getMaxInputTokensForModel,
    getModelPricing,
    getModelDisplayName,
    transformModelNameForProvider,
} from './index.js';
import type { Logger } from '../../logger/v2/types.js';

// Mock the OpenRouter model registry (required by index.ts)
vi.mock('../providers/openrouter-model-registry.js', () => ({
    getCachedOpenRouterModelsWithInfo: vi.fn(() => null),
    getOpenRouterModelCacheInfo: vi.fn(() => ({
        lastFetchedAt: null,
        modelCount: 0,
        isFresh: false,
    })),
    getOpenRouterModelContextLength: vi.fn(),
    scheduleOpenRouterModelRefresh: vi.fn(),
}));

const mockLogger: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trackException: vi.fn(),
    createChild: vi.fn(function (this: any) {
        return this;
    }),
    destroy: vi.fn(),
} as any;

describe('MiniMax provider registry', () => {
    it('minimax is a registered provider', () => {
        expect(LLM_REGISTRY).toHaveProperty('minimax');
    });

    it('includes M2.7 and M2.7-highspeed models', () => {
        const modelNames = LLM_REGISTRY.minimax.models.map((m) => m.name);
        expect(modelNames).toContain('MiniMax-M2.7');
        expect(modelNames).toContain('MiniMax-M2.7-highspeed');
    });

    it('includes legacy models M2, M2.1, M2.5, M2.5-highspeed', () => {
        const modelNames = LLM_REGISTRY.minimax.models.map((m) => m.name);
        expect(modelNames).toContain('MiniMax-M2');
        expect(modelNames).toContain('MiniMax-M2.1');
        expect(modelNames).toContain('MiniMax-M2.5');
        expect(modelNames).toContain('MiniMax-M2.5-highspeed');
    });

    it('defaults to MiniMax-M2.7', () => {
        const defaultModel = getDefaultModelForProvider('minimax');
        expect(defaultModel).toBe('MiniMax-M2.7');
    });

    it('validates M2.7 as a valid minimax model', () => {
        expect(isValidProviderModel('minimax', 'MiniMax-M2.7')).toBe(true);
        expect(isValidProviderModel('minimax', 'MiniMax-M2.7-highspeed')).toBe(true);
    });

    it('M2.7 has 204K input token limit', () => {
        expect(getMaxInputTokensForModel('minimax', 'MiniMax-M2.7', mockLogger)).toBe(204800);
        expect(getMaxInputTokensForModel('minimax', 'MiniMax-M2.7-highspeed', mockLogger)).toBe(
            204800
        );
    });

    it('M2.7 has correct pricing', () => {
        const pricing = getModelPricing('minimax', 'MiniMax-M2.7');
        expect(pricing).toBeDefined();
        expect(pricing!.inputPerM).toBe(0.3);
        expect(pricing!.outputPerM).toBe(1.2);
    });

    it('M2.7-highspeed has higher pricing', () => {
        const pricing = getModelPricing('minimax', 'MiniMax-M2.7-highspeed');
        expect(pricing).toBeDefined();
        expect(pricing!.inputPerM).toBe(0.6);
        expect(pricing!.outputPerM).toBe(2.4);
    });

    it('M2.7 models have correct display names', () => {
        expect(getModelDisplayName('MiniMax-M2.7', 'minimax')).toBe('MiniMax-M2.7');
        expect(getModelDisplayName('MiniMax-M2.7-highspeed', 'minimax')).toBe(
            'MiniMax-M2.7-highspeed'
        );
    });

    it('M2.7 models support reasoning and tool calls', () => {
        const m27 = LLM_REGISTRY.minimax.models.find((m) => m.name === 'MiniMax-M2.7');
        expect(m27).toBeDefined();
        expect(m27!.reasoning).toBe(true);
        expect(m27!.supportsToolCall).toBe(true);
        expect(m27!.supportsTemperature).toBe(true);
    });

    it('does not require base URL', () => {
        expect(LLM_REGISTRY.minimax.baseURLSupport).toBe('none');
    });

    it('transforms to OpenRouter format with minimax prefix', () => {
        const result = transformModelNameForProvider('MiniMax-M2.7', 'minimax', 'openrouter');
        expect(result).toBe('minimax/MiniMax-M2.7');
    });
});
