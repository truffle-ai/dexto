import { describe, expect, it } from 'vitest';
import { resolveRequestedAuthMode } from './login.js';

describe('resolveRequestedAuthMode', () => {
    it('returns null when no auth mode flags are provided', () => {
        expect(resolveRequestedAuthMode({})).toBeNull();
    });

    it('returns device when --device flag is set', () => {
        expect(resolveRequestedAuthMode({ device: true })).toBe('device');
    });

    it('parses valid --auth-mode values', () => {
        expect(resolveRequestedAuthMode({ authMode: 'auto' })).toBe('auto');
        expect(resolveRequestedAuthMode({ authMode: 'browser' })).toBe('browser');
        expect(resolveRequestedAuthMode({ authMode: 'device' })).toBe('device');
    });

    it('throws for invalid --auth-mode values', () => {
        expect(() => resolveRequestedAuthMode({ authMode: 'invalid' })).toThrow(
            'Invalid --auth-mode: invalid. Use one of: auto, browser, device'
        );
    });

    it('throws when --auth-mode and --device are both set', () => {
        expect(() => resolveRequestedAuthMode({ authMode: 'browser', device: true })).toThrow(
            'Cannot use both --device and --auth-mode. Choose one login mode option.'
        );
    });
});
