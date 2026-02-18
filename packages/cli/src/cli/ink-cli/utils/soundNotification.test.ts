import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { SoundNotificationService, type SoundConfig } from './soundNotification.js';

// Mock child_process execFile
vi.mock('child_process', () => ({
    execFile: vi.fn((_file, _args, _options, callback) => {
        // Handle both (file, args, callback) and (file, args, options, callback) signatures
        const cb = typeof _options === 'function' ? _options : callback;
        if (cb) cb(null, '', '');
    }),
}));

const mockedExecFile = vi.mocked(execFile);

// Full config for testing (mirrors defaults from PreferenceSoundsSchema)
const TEST_CONFIG: SoundConfig = {
    enabled: true,
    onStartup: true,
    onApprovalRequired: true,
    onTaskComplete: true,
};

describe('SoundNotificationService', () => {
    let originalStdoutWrite: typeof process.stdout.write;
    let writeSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        originalStdoutWrite = process.stdout.write;
        writeSpy = vi.fn();
        process.stdout.write = writeSpy as unknown as typeof process.stdout.write;
    });

    afterEach(() => {
        process.stdout.write = originalStdoutWrite;
    });

    describe('constructor', () => {
        it('should accept full config', () => {
            const service = new SoundNotificationService(TEST_CONFIG);
            expect(service.getConfig()).toEqual(TEST_CONFIG);
        });

        it('should allow disabling specific sounds', () => {
            const config: SoundConfig = {
                enabled: true,
                onStartup: false,
                onApprovalRequired: false,
                onTaskComplete: true,
            };
            const service = new SoundNotificationService(config);
            expect(service.getConfig()).toEqual(config);
        });
    });

    describe('setConfig', () => {
        it('should update config', () => {
            const service = new SoundNotificationService({ ...TEST_CONFIG, enabled: false });
            service.setConfig({ enabled: true });
            expect(service.getConfig().enabled).toBe(true);
        });
    });

    describe('playApprovalSound', () => {
        it('should not play when sounds disabled', () => {
            const service = new SoundNotificationService({ ...TEST_CONFIG, enabled: false });
            service.playApprovalSound();
            // No bell should be written when disabled
            expect(writeSpy).not.toHaveBeenCalled();
        });

        it('should not play when approval sounds disabled', () => {
            const service = new SoundNotificationService({
                ...TEST_CONFIG,
                onApprovalRequired: false,
            });
            service.playApprovalSound();
            // The service checks onApprovalRequired before playing
            expect(writeSpy).not.toHaveBeenCalled();
        });

        it('should attempt to play sound when enabled', () => {
            const service = new SoundNotificationService(TEST_CONFIG);
            mockedExecFile.mockClear();
            writeSpy.mockClear();
            service.playApprovalSound();
            // Should either call exec (platform sound) or write bell (fallback)
            const soundAttempted =
                mockedExecFile.mock.calls.length > 0 || writeSpy.mock.calls.length > 0;
            expect(soundAttempted).toBe(true);
        });
    });

    describe('playStartupSound', () => {
        it('should not play when startup sounds disabled', () => {
            const service = new SoundNotificationService({
                ...TEST_CONFIG,
                onStartup: false,
            });
            service.playStartupSound();
            expect(writeSpy).not.toHaveBeenCalled();
        });

        it('should attempt to play sound when enabled', () => {
            const service = new SoundNotificationService({
                ...TEST_CONFIG,
                onStartup: true,
            });
            mockedExecFile.mockClear();
            writeSpy.mockClear();
            service.playStartupSound();
            const soundAttempted =
                mockedExecFile.mock.calls.length > 0 || writeSpy.mock.calls.length > 0;
            expect(soundAttempted).toBe(true);
        });
    });

    describe('playCompleteSound', () => {
        it('should not play when sounds disabled', () => {
            const service = new SoundNotificationService({ ...TEST_CONFIG, enabled: false });
            service.playCompleteSound();
            expect(writeSpy).not.toHaveBeenCalled();
        });

        it('should not play when complete sounds disabled', () => {
            const service = new SoundNotificationService({
                ...TEST_CONFIG,
                onTaskComplete: false,
            });
            service.playCompleteSound();
            expect(writeSpy).not.toHaveBeenCalled();
        });

        it('should attempt to play sound when enabled', () => {
            const service = new SoundNotificationService(TEST_CONFIG);
            mockedExecFile.mockClear();
            writeSpy.mockClear();
            service.playCompleteSound();
            // Should either call exec (platform sound) or write bell (fallback)
            const soundAttempted =
                mockedExecFile.mock.calls.length > 0 || writeSpy.mock.calls.length > 0;
            expect(soundAttempted).toBe(true);
        });
    });
});
