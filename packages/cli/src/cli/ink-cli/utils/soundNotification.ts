/**
 * Sound Notification Utility
 *
 * Plays system sounds for CLI notifications like approval requests and task completion.
 * Uses platform-specific commands with fallback to terminal bell.
 *
 * Sound files should be placed in ~/.dexto/sounds/ or use system defaults.
 */

import { exec } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';

export type SoundType = 'approval' | 'complete';

/**
 * Platform-specific default sound paths
 */
const PLATFORM_SOUNDS: Record<string, Record<SoundType, string>> = {
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

/**
 * Get custom sound path from ~/.dexto/sounds/
 */
function getCustomSoundPath(soundType: SoundType): string | null {
    const dextoSoundsDir = join(homedir(), '.dexto', 'sounds');
    const extensions = ['.wav', '.mp3', '.ogg', '.aiff', '.m4a'];

    for (const ext of extensions) {
        const customPath = join(dextoSoundsDir, `${soundType}${ext}`);
        if (existsSync(customPath)) {
            return customPath;
        }
    }

    return null;
}

/**
 * Play a sound file using platform-specific command
 */
function playSound(soundPath: string): void {
    const currentPlatform = platform();

    let command: string;

    switch (currentPlatform) {
        case 'darwin':
            // macOS: use afplay
            command = `afplay "${soundPath}"`;
            break;

        case 'linux':
            // Linux: try paplay (PulseAudio), then aplay (ALSA)
            if (soundPath.endsWith('.oga') || soundPath.endsWith('.ogg')) {
                command = `paplay "${soundPath}" 2>/dev/null || ogg123 -q "${soundPath}" 2>/dev/null`;
            } else {
                command = `paplay "${soundPath}" 2>/dev/null || aplay -q "${soundPath}" 2>/dev/null`;
            }
            break;

        case 'win32':
            // Windows: use PowerShell with System.Media.SystemSounds
            // For Windows system sounds, soundPath is the sound name
            if (
                ['SystemAsterisk', 'SystemHand', 'SystemExclamation', 'SystemQuestion'].includes(
                    soundPath
                )
            ) {
                command = `powershell -c "[System.Media.SystemSounds]::${soundPath.replace('System', '')}.Play()"`;
            } else {
                // For custom files, use SoundPlayer
                command = `powershell -c "(New-Object System.Media.SoundPlayer '${soundPath}').PlaySync()"`;
            }
            break;

        default:
            // Fallback: try to use terminal bell
            playTerminalBell();
            return;
    }

    // Execute sound command asynchronously (fire and forget)
    exec(command, (error) => {
        if (error) {
            // Silently fall back to terminal bell on error
            playTerminalBell();
        }
    });
}

/**
 * Play terminal bell (works in most terminals)
 */
function playTerminalBell(): void {
    process.stdout.write('\x07');
}

/**
 * Play a notification sound
 *
 * @param soundType - Type of sound to play ('approval' or 'complete')
 *
 * @example
 * ```typescript
 * // Play approval required sound
 * playNotificationSound('approval');
 *
 * // Play task complete sound
 * playNotificationSound('complete');
 * ```
 */
export function playNotificationSound(soundType: SoundType): void {
    const currentPlatform = platform();

    // Check for custom sound first
    const customSound = getCustomSoundPath(soundType);
    if (customSound) {
        playSound(customSound);
        return;
    }

    // Use platform default
    const platformSounds = PLATFORM_SOUNDS[currentPlatform];
    if (platformSounds) {
        const defaultSound = platformSounds[soundType];
        if (defaultSound) {
            // For macOS and Linux, check if file exists
            if (currentPlatform !== 'win32') {
                if (existsSync(defaultSound)) {
                    playSound(defaultSound);
                } else {
                    // File doesn't exist, use bell
                    playTerminalBell();
                }
            } else {
                // Windows uses system sound names
                playSound(defaultSound);
            }
            return;
        }
    }

    // Fallback to terminal bell
    playTerminalBell();
}

/**
 * Sound configuration interface
 *
 * Note: Default values are defined in PreferenceSoundsSchema (packages/agent-management/src/preferences/schemas.ts)
 * which is the single source of truth for sound preferences.
 */
export interface SoundConfig {
    enabled: boolean;
    onApprovalRequired: boolean;
    onTaskComplete: boolean;
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
     * Play approval required sound if enabled
     */
    playApprovalSound(): void {
        if (this.config.enabled && this.config.onApprovalRequired) {
            playNotificationSound('approval');
        }
    }

    /**
     * Play task complete sound if enabled
     */
    playCompleteSound(): void {
        if (this.config.enabled && this.config.onTaskComplete) {
            playNotificationSound('complete');
        }
    }
}

/**
 * Singleton instance for global use
 * Initialize with loadGlobalPreferences() in CLI startup
 */
let globalSoundService: SoundNotificationService | null = null;

/**
 * Get the global sound notification service
 * @returns The global service, or null if not initialized
 */
export function getSoundService(): SoundNotificationService | null {
    return globalSoundService;
}

/**
 * Initialize the global sound service with configuration
 */
export function initializeSoundService(config: SoundConfig): SoundNotificationService {
    globalSoundService = new SoundNotificationService(config);
    return globalSoundService;
}
