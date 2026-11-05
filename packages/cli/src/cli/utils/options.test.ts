import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { validateCliOptions } from './options.js';

describe('validateCliOptions', () => {
    it('does not throw for minimal valid options', () => {
        const opts = { agent: 'config.yml' };
        expect(() => validateCliOptions(opts)).not.toThrow();
    });

    it('does not throw for missing agent (now optional)', () => {
        const opts = {};
        expect(() => validateCliOptions(opts)).not.toThrow();
    });

    it('throws ZodError for empty agent string', () => {
        const opts = { agent: '' };
        expect(() => validateCliOptions(opts)).toThrow(ZodError);
    });

    it('validates interactive flag correctly', () => {
        const optsWithNoInteractive = { interactive: false };
        expect(() => validateCliOptions(optsWithNoInteractive)).not.toThrow();

        const optsWithInteractive = { interactive: true };
        expect(() => validateCliOptions(optsWithInteractive)).not.toThrow();

        const optsWithoutFlag = {};
        expect(() => validateCliOptions(optsWithoutFlag)).not.toThrow();
    });

    it('accepts bypassPermissions flag', () => {
        const opts = { bypassPermissions: true };
        expect(() => validateCliOptions(opts)).not.toThrow();
    });
});
