/**
 * Sound Notification Utility
 *
 * Plays system sounds for CLI notifications like approval requests and task completion.
 * Uses platform-specific commands with fallback to terminal bell.
 *
 * Sound files should be placed in the Dexto sounds directory (typically ~/.dexto/sounds/).
 * In dexto source + DEXTO_DEV_MODE=true, this uses <repo>/.dexto/sounds/ for isolated dev.
 */

import { existsSync } from 'fs';
import { isAbsolute, normalize, resolve, sep } from 'path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'child_process';
import { getDextoGlobalPath } from '@dexto/agent-management';

export type SoundType = 'startup' | 'approval' | 'complete';

export const CUSTOM_SOUND_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.oga', '.aiff', '.m4a'] as const;

type SoundFileKey = 'startupSoundFile' | 'approvalSoundFile' | 'completeSoundFile';

function getSoundFileKey(soundType: SoundType): SoundFileKey {
    switch (soundType) {
        case 'startup':
            return 'startupSoundFile';
        case 'approval':
            return 'approvalSoundFile';
        case 'complete':
            return 'completeSoundFile';
    }
}

function resolvePathWithinSoundsDir(soundPath: string): string | null {
    if (soundPath.trim().length === 0) return null;

    const soundsDir = normalize(getDextoGlobalPath('sounds'));

    const resolved = isAbsolute(soundPath) ? normalize(soundPath) : resolve(soundsDir, soundPath);

    if (resolved === soundsDir || resolved.startsWith(soundsDir + sep)) {
        return resolved;
    }

    return null;
}

/**
 * Platform-specific default sound paths
 */
const PLATFORM_SOUNDS: Record<string, Partial<Record<SoundType, string>>> = {
    darwin: {
        // macOS system sounds
        approval: '/System/Library/Sounds/Blow.aiff',
        complete: '/System/Library/Sounds/Glass.aiff',
    },
    linux: {
        // Common Linux sound paths (freedesktop)
        approval: '/usr/share/sounds/freedesktop/stereo/message-new-instant.oga',
        complete: '/usr/share/sounds/freedesktop/stereo/complete.oga',
    },
    win32: {
        // Windows system sounds (handled differently via PowerShell)
        approval: 'SystemAsterisk',
        complete: 'SystemHand',
    },
};

const BUNDLED_STARTUP_SOUND_PATH = fileURLToPath(
    new URL('../../assets/sounds/startup.wav', import.meta.url)
);

export function getDefaultSoundSpec(soundType: SoundType): string | null {
    if (soundType === 'startup') {
        return BUNDLED_STARTUP_SOUND_PATH;
    }

    const platformSounds = PLATFORM_SOUNDS[process.platform];
    return platformSounds?.[soundType] ?? null;
}

/**
 * Play a sound file using platform-specific command
 */
function playSound(soundPath: string): void {
    const execOrBell = (cmd: string, args: string[], onError?: () => void) => {
        execFile(cmd, args, { windowsHide: true }, (error) => {
            if (!error) return;
            if (onError) {
                onError();
                return;
            }
            playTerminalBell();
        });
    };

    switch (process.platform) {
        case 'darwin': {
            execOrBell('afplay', [soundPath]);
            return;
        }

        case 'linux': {
            const lowerSoundPath = soundPath.toLowerCase();
            const isOgg = lowerSoundPath.endsWith('.oga') || lowerSoundPath.endsWith('.ogg');
            if (isOgg) {
                execOrBell('paplay', [soundPath], () => {
                    execOrBell('ogg123', ['-q', soundPath]);
                });
            } else {
                execOrBell('paplay', [soundPath], () => {
                    execOrBell('aplay', ['-q', soundPath]);
                });
            }
            return;
        }

        case 'win32': {
            // Windows: use PowerShell with System.Media.SystemSounds
            // For Windows system sounds, soundPath is the sound name
            if (
                ['SystemAsterisk', 'SystemHand', 'SystemExclamation', 'SystemQuestion'].includes(
                    soundPath
                )
            ) {
                const systemSoundName = soundPath.replace('System', '');
                execOrBell('powershell', [
                    '-NoProfile',
                    '-NonInteractive',
                    '-Command',
                    `[System.Media.SystemSounds]::${systemSoundName}.Play()`,
                ]);
                return;
            }

            // For custom files, use SoundPlayer
            execOrBell('powershell', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                '& { param([string]$p) (New-Object System.Media.SoundPlayer $p).PlaySync() }',
                soundPath,
            ]);
            return;
        }

        default: {
            // Fallback: try to use terminal bell
            playTerminalBell();
            return;
        }
    }
}

export function playSoundFile(soundPath: string): void {
    playSound(soundPath);
}

/**
 * Play terminal bell (works in most terminals)
 */
function playTerminalBell(): void {
    process.stdout.write('\x07');
}

function resolveNotificationSoundSpec(soundType: SoundType, config?: SoundConfig): string | null {
    const configuredRelativePath = config?.[getSoundFileKey(soundType)];
    if (configuredRelativePath) {
        const resolved = resolvePathWithinSoundsDir(configuredRelativePath);
        if (resolved && existsSync(resolved)) {
            return resolved;
        }
    }

    const defaultSpec = getDefaultSoundSpec(soundType);
    if (!defaultSpec) return null;

    if (process.platform === 'win32') {
        return defaultSpec;
    }

    return existsSync(defaultSpec) ? defaultSpec : null;
}

/**
 * Play a notification sound
 *
 * @param soundType - Type of sound to play ('startup', 'approval', or 'complete')
 *
 * @example
 * ```typescript
 * // Play approval required sound
 * playNotificationSound('approval');
 *
 * // Play task complete sound
 * playNotificationSound('complete');
 *
 * // Play startup sound
 * playNotificationSound('startup');
 * ```
 */
export function playNotificationSound(soundType: SoundType, config?: SoundConfig): void {
    const soundSpec = resolveNotificationSoundSpec(soundType, config);
    if (!soundSpec) {
        playTerminalBell();
        return;
    }

    playSound(soundSpec);
}

/**
 * Sound configuration interface
 *
 * Note: Default values are defined in PreferenceSoundsSchema (packages/agent-management/src/preferences/schemas.ts)
 * which is the single source of truth for sound preferences.
 */
export interface SoundConfig {
    enabled: boolean;
    onStartup: boolean;
    startupSoundFile?: string | undefined;
    onApprovalRequired: boolean;
    approvalSoundFile?: string | undefined;
    onTaskComplete: boolean;
    completeSoundFile?: string | undefined;
}

/**
 * Sound notification service that respects configuration
 *
 * All fields are required - callers should provide complete config from preferences.
 * Default values come from PreferenceSoundsSchema in @dexto/agent-management.
 */
export class SoundNotificationService {
    private config: SoundConfig;

    constructor(config: SoundConfig) {
        this.config = { ...config };
    }

    /**
     * Update configuration
     */
    setConfig(config: Partial<SoundConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current configuration
     */
    getConfig(): SoundConfig {
        return { ...this.config };
    }

    /**
     * Play CLI startup sound if enabled
     */
    playStartupSound(): void {
        if (this.config.enabled && this.config.onStartup) {
            playNotificationSound('startup', this.config);
        }
    }

    /**
     * Play approval required sound if enabled
     */
    playApprovalSound(): void {
        if (this.config.enabled && this.config.onApprovalRequired) {
            playNotificationSound('approval', this.config);
        }
    }

    /**
     * Play task complete sound if enabled
     */
    playCompleteSound(): void {
        if (this.config.enabled && this.config.onTaskComplete) {
            playNotificationSound('complete', this.config);
        }
    }
}
