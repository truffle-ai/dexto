import { describe, expect, it } from 'vitest';
import {
    assertValidPromptName,
    isValidPromptName,
    PROMPT_NAME_GUIDANCE,
} from './name-validation.js';

describe('prompt name validation helpers', () => {
    it('accepts valid kebab-case names', () => {
        expect(isValidPromptName('code-review')).toBe(true);
        expect(isValidPromptName('debug')).toBe(true);
        expect(() => assertValidPromptName('explain-more')).not.toThrow();
    });

    it('rejects names with uppercase letters or spaces', () => {
        expect(isValidPromptName('CodeReview')).toBe(false);
        expect(isValidPromptName('code review')).toBe(false);
        expect(isValidPromptName('code_review')).toBe(false);
        expect(() => assertValidPromptName('Code Review')).toThrowError(PROMPT_NAME_GUIDANCE);
    });

    it('rejects names with leading or trailing hyphens', () => {
        expect(isValidPromptName('-code')).toBe(false);
        expect(isValidPromptName('code-')).toBe(false);
        expect(isValidPromptName('code--review')).toBe(false);
    });
});
