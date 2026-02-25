import { describe, expect, it } from 'vitest';
import { shouldAttemptBrowserLaunch } from './browser-launch.js';

function makeEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return {
        ...overrides,
    };
}

describe('shouldAttemptBrowserLaunch', () => {
    it('returns false in CI environments', () => {
        const result = shouldAttemptBrowserLaunch({
            env: makeEnv({ CI: 'true' }),
            platform: 'darwin',
        });

        expect(result).toBe(false);
    });

    it('returns false on Linux when no display is available', () => {
        const result = shouldAttemptBrowserLaunch({
            env: makeEnv({}),
            platform: 'linux',
        });

        expect(result).toBe(false);
    });

    it('returns true on Linux when display is available', () => {
        const result = shouldAttemptBrowserLaunch({
            env: makeEnv({ DISPLAY: ':0' }),
            platform: 'linux',
        });

        expect(result).toBe(true);
    });

    it('returns false for blocked browser env var', () => {
        const result = shouldAttemptBrowserLaunch({
            env: makeEnv({ BROWSER: 'www-browser' }),
            platform: 'darwin',
        });

        expect(result).toBe(false);
    });

    it('returns false when browser is explicitly disabled', () => {
        const result = shouldAttemptBrowserLaunch({
            env: makeEnv({ BROWSER: 'NONE' }),
            platform: 'darwin',
        });

        expect(result).toBe(false);
    });

    it('returns false for SSH sessions on non-linux platforms', () => {
        const result = shouldAttemptBrowserLaunch({
            env: makeEnv({ SSH_CONNECTION: '1' }),
            platform: 'darwin',
        });

        expect(result).toBe(false);
    });
});
