import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SoundNotificationService, type SoundConfig } from './soundNotification.js';

// Mock child_process exec
vi.mock('child_process', () => ({
    exec: vi.fn((command, callback) => {
        if (callback) callback(null, '', '');
    }),
}));

// Full config for testing (mirrors defaults from PreferenceSoundsSchema)
const TEST_CONFIG: SoundConfig = {
    enabled: true,
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
    });
});
