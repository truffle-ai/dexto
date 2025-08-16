import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { validateCliOptions } from './options.js';

describe('validateCliOptions', () => {
    it('does not throw for minimal valid options', () => {
        const opts = { agent: 'config.yml', mode: 'cli', webPort: '8080' };
        expect(() => validateCliOptions(opts)).not.toThrow();
    });

    it('does not throw for missing agent (now optional)', () => {
        const opts = { mode: 'cli', webPort: '8080' };
        expect(() => validateCliOptions(opts)).not.toThrow();
    });

    it('throws ZodError for empty agent string', () => {
        const opts = { agent: '', mode: 'cli', webPort: '8080' };
        expect(() => validateCliOptions(opts)).toThrow(ZodError);
    });

    it('validates skipInteractive flag correctly', () => {
        const optsWithSkipInteractive = { mode: 'cli', webPort: '8080', skipInteractive: true };
        expect(() => validateCliOptions(optsWithSkipInteractive)).not.toThrow();

        const optsWithoutSkipInteractive = { mode: 'cli', webPort: '8080' };
        expect(() => validateCliOptions(optsWithoutSkipInteractive)).not.toThrow();
    });
});
