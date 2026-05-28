import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    getAllModelsForProvider,
    getModel,
    getModelCapabilities,
    getProvider,
    listModels,
    listProviders,
    resolveGatewayOrigin,
} from './index.js';

describe('@dexto/llm catalog helpers', () => {
    it('does not depend on core, CLI, cloud, filesystem, SQL, or credential packages', () => {
        const llmPackage = JSON.parse(
            readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
        ) as {
            dependencies?: Record<string, string>;
        };
        const dependencyNames = Object.keys(llmPackage.dependencies ?? {});
        expect(dependencyNames).not.toContain('@dexto/core');
        expect(dependencyNames).not.toContain('@dexto/cli');
        expect(dependencyNames).not.toContain('@dexto/server');
        expect(dependencyNames).not.toContain('@dexto/cloud');
        expect(dependencyNames).not.toContain('fs-extra');
        expect(dependencyNames).not.toContain('better-sqlite3');
    });

    it('returns explicit misses for unknown ids', () => {
        expect(getProvider('not-a-provider')).toBeNull();
        expect(getModel('openai', 'not-a-model')).toBeNull();
        expect(getModelCapabilities('openai', 'not-a-model')).toBeNull();
    });

    it('exposes broad string ids without mutating global catalog state', () => {
        const providers = listProviders();
        expect(providers).toContain('openai');
        expect(providers).toContain('dexto-nova');

        const provider = getProvider('openai');
        expect(provider).not.toBeNull();
        provider!.models.length = 0;

        expect(getProvider('openai')!.models.length).toBeGreaterThan(0);
    });

    it('does not expose mutable nested model metadata', () => {
        const providerModel = getProvider('openai')!.models[0]!;
        const originalProviderFileTypes = [...getProvider('openai')!.models[0]!.supportedFileTypes];
        providerModel.supportedFileTypes.length = 0;

        expect(getProvider('openai')!.models[0]!.supportedFileTypes).toEqual(
            originalProviderFileTypes
        );

        const gatewayModel = getAllModelsForProvider('dexto-nova')[0]!;
        const originalGatewayFileTypes = [
            ...getAllModelsForProvider('dexto-nova')[0]!.supportedFileTypes,
        ];
        gatewayModel.supportedFileTypes.length = 0;

        expect(getAllModelsForProvider('dexto-nova')[0]!.supportedFileTypes).toEqual(
            originalGatewayFileTypes
        );
    });

    it('lists gateway models and resolves known OpenRouter-format origins', () => {
        const models = listModels('dexto-nova');
        expect(models.some((entry) => entry.modelId.startsWith('openai/'))).toBe(true);
        expect(resolveGatewayOrigin('dexto-nova', 'openai/gpt-5-mini')).toEqual({
            providerId: 'openai',
            modelId: 'gpt-5-mini',
        });
    });
});
