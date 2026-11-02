import { describe, expect, it } from 'vitest';
import { countDirtyFiles } from './useGitDirtyFiles.js';

describe('countDirtyFiles', () => {
    it('counts one per changed path and ignores blank lines', () => {
        expect(countDirtyFiles(' M src/a.ts\n?? src/b.ts\nR  old.ts -> new.ts\n')).toBe(3);
        expect(countDirtyFiles('')).toBe(0);
    });
});
