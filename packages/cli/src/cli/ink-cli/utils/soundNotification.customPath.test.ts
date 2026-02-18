import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

vi.mock('fs', () => ({
    existsSync: vi.fn(),
}));

vi.mock('os', () => ({
    homedir: () => '/home/test-user',
    platform: () => 'darwin',
}));

vi.mock('child_process', () => ({
    exec: vi.fn(),
}));

import { existsSync } from 'fs';
import { CUSTOM_SOUND_EXTENSIONS, getCustomSoundPath } from './soundNotification.js';

describe('getCustomSoundPath', () => {
    const soundsDir = path.join('/home/test-user', '.dexto', 'sounds');
    const existsSyncMock = vi.mocked(existsSync);

    beforeEach(() => {
        existsSyncMock.mockReset();
    });

    it('uses .wav first by default', () => {
        expect(CUSTOM_SOUND_EXTENSIONS[0]).toBe('.wav');
    });

    it('returns null when no custom sound exists', () => {
        existsSyncMock.mockReturnValue(false);
        expect(getCustomSoundPath('approval')).toBeNull();
    });

    it('prefers .wav when multiple extensions exist', () => {
        const wavPath = path.join(soundsDir, 'approval.wav');
        const mp3Path = path.join(soundsDir, 'approval.mp3');

        existsSyncMock.mockImplementation((candidatePath) => {
            const candidatePathStr = String(candidatePath);
            return candidatePathStr === wavPath || candidatePathStr === mp3Path;
        });

        expect(getCustomSoundPath('approval')).toBe(wavPath);
    });

    it('returns .mp3 when .wav is missing', () => {
        const mp3Path = path.join(soundsDir, 'complete.mp3');

        existsSyncMock.mockImplementation((candidatePath) => String(candidatePath) === mp3Path);

        expect(getCustomSoundPath('complete')).toBe(mp3Path);
    });
});
