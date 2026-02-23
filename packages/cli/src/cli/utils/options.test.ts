import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { validateCliOptions } from './options.js';

describe('validateCliOptions', () => {
    it('does not throw for minimal valid options', () => {
        const opts = { agent: 'config.yml', mode: 'cli', port: '8080' };
        expect(() => validateCliOptions(opts)).not.toThrow();
    });

    it('does not throw for missing agent (now optional)', () => {
        const opts = { mode: 'cli', port: '8080' };
        expect(() => validateCliOptions(opts)).not.toThrow();
    });

    it('throws ZodError for empty agent string', () => {
        const opts = { agent: '', mode: 'cli', port: '8080' };
        expect(() => validateCliOptions(opts)).toThrow(ZodError);
    });

    it('validates interactive flag correctly', () => {
        const optsWithNoInteractive = { mode: 'cli', port: '8080', interactive: false };
        expect(() => validateCliOptions(optsWithNoInteractive)).not.toThrow();

        const optsWithInteractive = { mode: 'cli', port: '8080', interactive: true };
        expect(() => validateCliOptions(optsWithInteractive)).not.toThrow();

        const optsWithoutFlag = { mode: 'cli', port: '8080' };
        expect(() => validateCliOptions(optsWithoutFlag)).not.toThrow();
    });

    it('accepts bypassPermissions flag', () => {
        const opts = { mode: 'cli', port: '8080', bypassPermissions: true };
        expect(() => validateCliOptions(opts)).not.toThrow();
    });
});
