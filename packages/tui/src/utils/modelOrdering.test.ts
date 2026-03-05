import { describe, expect, it } from 'vitest';
import {
    compareModelsLatestFirst,
    isDeprecatedModelStatus,
    type ModelRecencyCandidate,
} from './modelOrdering.js';

function sortModels(models: ModelRecencyCandidate[]): string[] {
    return [...models].sort(compareModelsLatestFirst).map((model) => model.name);
}

describe('compareModelsLatestFirst', () => {
    it('prioritizes releaseDate over version-like tokens in model names', () => {
        const sorted = sortModels([
            { name: 'gpt-oss-120b' },
            { name: 'gpt-5.2', releaseDate: '2026-02-05' },
            { name: 'gpt-5.1', releaseDate: '2025-12-11' },
        ]);

        expect(sorted).toEqual(['gpt-5.2', 'gpt-5.1', 'gpt-oss-120b']);
    });

    it('sorts by releaseDate descending when available', () => {
        const sorted = sortModels([
            { name: 'gpt-4', releaseDate: '2023-11-06' },
            { name: 'gpt-5', releaseDate: '2025-08-07' },
            { name: 'gpt-4o', releaseDate: '2024-05-13' },
        ]);

        expect(sorted).toEqual(['gpt-5', 'gpt-4o', 'gpt-4']);
    });

    it('keeps dated models ahead of undated models', () => {
        const sorted = sortModels([
            { name: 'gpt-4.1' },
            { name: 'gpt-5.1', releaseDate: '2025-12-11' },
            { name: 'gpt-5.2', releaseDate: '2026-02-05' },
        ]);

        expect(sorted).toEqual(['gpt-5.2', 'gpt-5.1', 'gpt-4.1']);
    });

    it('falls back to numeric-aware version ordering when release dates tie', () => {
        const sorted = sortModels([
            { name: 'gpt-5.1', releaseDate: '2025-08-01' },
            { name: 'gpt-5.2', releaseDate: '2025-08-01' },
            { name: 'gpt-5.10', releaseDate: '2025-08-01' },
        ]);

        expect(sorted).toEqual(['gpt-5.10', 'gpt-5.2', 'gpt-5.1']);
    });

    it('falls back to numeric-aware ordering for undated models', () => {
        const sorted = sortModels([
            { name: 'minimax-m2' },
            { name: 'minimax-m2.5' },
            { name: 'minimax-m2.1' },
        ]);

        expect(sorted).toEqual(['minimax-m2.5', 'minimax-m2.1', 'minimax-m2']);
    });
});

describe('isDeprecatedModelStatus', () => {
    it('returns true for deprecated status', () => {
        expect(isDeprecatedModelStatus('deprecated')).toBe(true);
        expect(isDeprecatedModelStatus('DEPRECATED')).toBe(true);
    });

    it('returns false for undefined or non-deprecated status', () => {
        expect(isDeprecatedModelStatus(undefined)).toBe(false);
        expect(isDeprecatedModelStatus('active')).toBe(false);
        expect(isDeprecatedModelStatus('preview')).toBe(false);
    });
});
