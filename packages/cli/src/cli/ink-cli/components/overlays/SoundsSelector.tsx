/**
 * SoundsSelector Component
 * Interactive overlay for configuring sound notifications and selecting built-in sounds.
 *
 * Built-in sounds are copied into ~/.dexto/sounds/ as:
 * - approval.wav
 * - complete.wav
 *
 * This reuses the existing sound resolution logic in soundNotification.ts.
 */

import React, {
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
    forwardRef,
} from 'react';
import { Box, Text } from 'ink';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';
import {
    CUSTOM_SOUND_EXTENSIONS,
    getCustomSoundPath,
    playNotificationSound,
    type SoundConfig,
    type SoundType,
} from '../../utils/soundNotification.js';
import { useSoundService } from '../../contexts/index.js';
import {
    getDextoGlobalPath,
    globalPreferencesExist,
    loadGlobalPreferences,
    updateGlobalPreferences,
} from '@dexto/agent-management';

interface SoundsSelectorProps {
    isVisible: boolean;
    onClose: () => void;
}

export interface SoundsSelectorHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface BuiltinSound {
    id: string;
    name: string;
    description: string;
    filename: string;
}

const BUILTIN_SOUNDS: BuiltinSound[] = [
    {
        id: 'coin',
        name: 'Coin',
        description: 'Quick retro coin blip',
        filename: 'coin.wav',
    },
    {
        id: 'confirm',
        name: 'Confirm',
        description: 'Short confirm click',
        filename: 'confirm.wav',
    },
    {
        id: 'ping',
        name: 'Ping',
        description: 'Sharp UI ping',
        filename: 'ping.wav',
    },
    {
        id: 'powerup',
        name: 'Power Up',
        description: 'Upward chiptune sweep',
        filename: 'powerup.wav',
    },
    {
        id: 'chime',
        name: 'Chime',
        description: 'Soft two-note chime',
        filename: 'chime.wav',
    },
    {
        id: 'levelup',
        name: 'Level Up',
        description: 'Triad level-up jingle',
        filename: 'levelup.wav',
    },
    {
        id: 'boot',
        name: 'Boot',
        description: 'Console-style startup beep',
        filename: 'boot.wav',
    },
    {
        id: 'gameboy',
        name: 'Game Boy',
        description: 'Classic handheld startup jingle',
        filename: 'gameboy.wav',
    },
    {
        id: 'success',
        name: 'Success',
        description: 'Bright completion jingle',
        filename: 'success.wav',
    },
    {
        id: 'win',
        name: 'Win',
        description: 'Spacey win flourish',
        filename: 'win.wav',
    },
    {
        id: 'treasure',
        name: 'Treasure Chest',
        description: 'Classic chest-open fanfare',
        filename: 'treasure.wav',
    },
];

type SoundSelection = { kind: 'system' } | { kind: 'builtin'; id: string } | { kind: 'custom' };

type ViewMode = 'main' | 'pick-approval' | 'pick-complete';

type MainItem =
    | {
          type: 'toggle';
          id: keyof SoundConfig;
          label: string;
          description: string;
          icon: string;
          value: boolean;
      }
    | {
          type: 'pick';
          id: 'pick-approval' | 'pick-complete';
          soundType: SoundType;
          label: string;
          description: string;
          icon: string;
      }
    | {
          type: 'action';
          id: 'test-approval' | 'test-complete' | 'reset-custom' | 'show-folder';
          label: string;
          description: string;
          icon: string;
      };

type PickItem =
    | { type: 'system-default'; id: 'system-default'; label: string; description: string }
    | {
          type: 'builtin';
          id: string;
          label: string;
          description: string;
          isCurrent: boolean;
      };

const DEFAULT_CONFIG: SoundConfig = {
    enabled: true,
    onApprovalRequired: true,
    onTaskComplete: true,
};

function soundConfigUpdate<K extends keyof SoundConfig>(
    key: K,
    value: SoundConfig[K]
): Partial<SoundConfig> {
    return { [key]: value } as Pick<SoundConfig, K>;
}

function selectionLabel(
    selection: SoundSelection,
    builtinSounds: ReadonlyArray<Pick<BuiltinSound, 'id' | 'name'>>
): string {
    if (selection.kind === 'system') return 'System default';
    if (selection.kind === 'custom') return 'Custom file';
    const builtin = builtinSounds.find((s) => s.id === selection.id);
    return builtin?.name ?? selection.id;
}

async function safeUnlink(filePath: string): Promise<void> {
    try {
        await fs.unlink(filePath);
    } catch (error) {
        // Ignore if missing
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
}

async function removeCustomSoundFiles(soundType: SoundType): Promise<void> {
    const soundsDir = getDextoGlobalPath('sounds');
    await Promise.all(
        CUSTOM_SOUND_EXTENSIONS.map((ext) => safeUnlink(path.join(soundsDir, `${soundType}${ext}`)))
    );
}

async function resolveSelection(
    soundType: SoundType,
    builtinBuffers: Map<string, Buffer>
): Promise<SoundSelection> {
    const customPath = getCustomSoundPath(soundType);
    if (!customPath) return { kind: 'system' };

    let customBuffer: Buffer;
    try {
        customBuffer = await fs.readFile(customPath);
    } catch {
        return { kind: 'system' };
    }

    for (const [id, builtinBuffer] of builtinBuffers.entries()) {
        if (builtinBuffer.equals(customBuffer)) {
            return { kind: 'builtin', id };
        }
    }

    return { kind: 'custom' };
}

const SoundsSelector = forwardRef<SoundsSelectorHandle, SoundsSelectorProps>(
    function SoundsSelector({ isVisible, onClose }, ref) {
        const soundService = useSoundService();

        const baseSelectorRef = useRef<BaseSelectorHandle>(null);
        const builtinBuffersRef = useRef<Map<string, Buffer>>(new Map());

        const [viewMode, setViewMode] = useState<ViewMode>('main');
        const [selectedIndex, setSelectedIndex] = useState(0);
        const [isLoading, setIsLoading] = useState(false);
        const [isApplying, setIsApplying] = useState(false);
        const [error, setError] = useState<string | null>(null);
        const [status, setStatus] = useState<string | null>(null);
        const [canPersistPreferences, setCanPersistPreferences] = useState(false);
        const [config, setConfig] = useState<SoundConfig>(DEFAULT_CONFIG);
        const [approvalSelection, setApprovalSelection] = useState<SoundSelection>({
            kind: 'system',
        });
        const [completeSelection, setCompleteSelection] = useState<SoundSelection>({
            kind: 'system',
        });

        const configRef = useRef(config);
        configRef.current = config;

        const closeOrBack = useCallback(() => {
            if (viewMode === 'main') {
                onClose();
                return;
            }
            setViewMode('main');
            setSelectedIndex(0);
            setStatus(null);
            setError(null);
        }, [onClose, viewMode]);

        // Forward handleInput to BaseSelector
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    return baseSelectorRef.current?.handleInput(input, key) ?? false;
                },
            }),
            []
        );

        const builtinSoundPaths = useMemo(() => {
            const assetSounds = BUILTIN_SOUNDS.map((sound) => ({
                ...sound,
                absPath: fileURLToPath(
                    new URL(`../../../assets/sounds/${sound.filename}`, import.meta.url)
                ),
                destExt: '.wav',
            }));

            const macOsDefaults =
                process.platform === 'darwin'
                    ? [
                          {
                              id: 'macos-blow',
                              name: 'macOS Blow',
                              description: 'System sound (Blow.aiff)',
                              filename: 'Blow.aiff',
                              absPath: '/System/Library/Sounds/Blow.aiff',
                              destExt: '.aiff',
                          },
                          {
                              id: 'macos-glass',
                              name: 'macOS Glass',
                              description: 'System sound (Glass.aiff)',
                              filename: 'Glass.aiff',
                              absPath: '/System/Library/Sounds/Glass.aiff',
                              destExt: '.aiff',
                          },
                      ]
                    : [];

            return [...assetSounds, ...macOsDefaults].filter((sound) => existsSync(sound.absPath));
        }, []);

        const refreshSelections = useCallback(async () => {
            const builtinBuffers = builtinBuffersRef.current;
            const [nextApproval, nextComplete] = await Promise.all([
                resolveSelection('approval', builtinBuffers),
                resolveSelection('complete', builtinBuffers),
            ]);
            setApprovalSelection(nextApproval);
            setCompleteSelection(nextComplete);
        }, []);

        // Load preferences + built-in sounds when becoming visible
        useEffect(() => {
            if (!isVisible) return;

            let cancelled = false;

            setIsLoading(true);
            setIsApplying(false);
            setError(null);
            setStatus(null);
            setViewMode('main');
            setSelectedIndex(0);

            const run = async () => {
                // Load preferences (optional)
                const prefsExist = globalPreferencesExist();
                setCanPersistPreferences(prefsExist);

                let nextConfig = DEFAULT_CONFIG;
                if (prefsExist) {
                    try {
                        const preferences = await loadGlobalPreferences();
                        nextConfig = {
                            enabled: preferences.sounds?.enabled ?? nextConfig.enabled,
                            onApprovalRequired:
                                preferences.sounds?.onApprovalRequired ??
                                nextConfig.onApprovalRequired,
                            onTaskComplete:
                                preferences.sounds?.onTaskComplete ?? nextConfig.onTaskComplete,
                        };
                    } catch (err) {
                        // Non-fatal: allow selection changes, but toggles won't persist
                        setCanPersistPreferences(false);
                        if (!cancelled) {
                            setError(
                                `Failed to load preferences: ${err instanceof Error ? err.message : String(err)}`
                            );
                        }
                    }
                }

                // Preload built-in sound buffers for quick comparisons
                const builtinBuffers = new Map<string, Buffer>();
                await Promise.all(
                    builtinSoundPaths.map(async (sound) => {
                        const buffer = await fs.readFile(sound.absPath);
                        builtinBuffers.set(sound.id, buffer);
                    })
                );
                builtinBuffersRef.current = builtinBuffers;

                if (!cancelled) {
                    setConfig(nextConfig);
                    soundService?.setConfig(nextConfig);
                    await refreshSelections();
                }
            };

            void run()
                .catch((err) => {
                    if (!cancelled) {
                        setError(err instanceof Error ? err.message : String(err));
                    }
                })
                .finally(() => {
                    if (!cancelled) setIsLoading(false);
                });

            return () => {
                cancelled = true;
            };
        }, [isVisible, builtinSoundPaths, refreshSelections, soundService]);

        const mainItems: MainItem[] = useMemo(() => {
            return [
                {
                    type: 'toggle',
                    id: 'enabled',
                    label: `Sounds: ${config.enabled ? 'Enabled' : 'Disabled'}`,
                    description: 'Master toggle for all sound notifications',
                    icon: config.enabled ? '🔊' : '🔇',
                    value: config.enabled,
                },
                {
                    type: 'toggle',
                    id: 'onApprovalRequired',
                    label: `On approval required: ${config.onApprovalRequired ? 'On' : 'Off'}`,
                    description: 'Play a sound when tool approval is needed',
                    icon: '🧠',
                    value: config.onApprovalRequired,
                },
                {
                    type: 'toggle',
                    id: 'onTaskComplete',
                    label: `On task complete: ${config.onTaskComplete ? 'On' : 'Off'}`,
                    description: 'Play a sound when the agent finishes a task',
                    icon: '✅',
                    value: config.onTaskComplete,
                },
                {
                    type: 'pick',
                    id: 'pick-approval',
                    soundType: 'approval',
                    label: `Select approval sound (${selectionLabel(approvalSelection, builtinSoundPaths)})`,
                    description: 'Choose a built-in sound or reset to system default',
                    icon: '🔔',
                },
                {
                    type: 'pick',
                    id: 'pick-complete',
                    soundType: 'complete',
                    label: `Select completion sound (${selectionLabel(completeSelection, builtinSoundPaths)})`,
                    description: 'Choose a built-in sound or reset to system default',
                    icon: '🏁',
                },
                {
                    type: 'action',
                    id: 'test-approval',
                    label: 'Test approval sound',
                    description: 'Plays the current approval sound (ignores enabled toggles)',
                    icon: '▶️',
                },
                {
                    type: 'action',
                    id: 'test-complete',
                    label: 'Test completion sound',
                    description: 'Plays the current completion sound (ignores enabled toggles)',
                    icon: '▶️',
                },
                {
                    type: 'action',
                    id: 'reset-custom',
                    label: 'Reset custom sounds (system defaults)',
                    description: 'Removes custom sound files from ~/.dexto/sounds/',
                    icon: '♻️',
                },
                {
                    type: 'action',
                    id: 'show-folder',
                    label: 'Show sounds folder',
                    description: 'Displays the path to ~/.dexto/sounds/',
                    icon: '📁',
                },
            ];
        }, [approvalSelection, builtinSoundPaths, completeSelection, config]);

        const pickSoundType: SoundType | null =
            viewMode === 'pick-approval'
                ? 'approval'
                : viewMode === 'pick-complete'
                  ? 'complete'
                  : null;

        const pickItems: PickItem[] = useMemo(() => {
            if (!pickSoundType) return [];

            const current = pickSoundType === 'approval' ? approvalSelection : completeSelection;

            const items: PickItem[] = [
                {
                    type: 'system-default',
                    id: 'system-default',
                    label: 'System default',
                    description: 'Use the platform default notification sound',
                },
                ...builtinSoundPaths.map((sound) => ({
                    type: 'builtin' as const,
                    id: sound.id,
                    label: sound.name,
                    description: sound.description,
                    isCurrent: current.kind === 'builtin' && current.id === sound.id,
                })),
            ];

            return items;
        }, [approvalSelection, builtinSoundPaths, completeSelection, pickSoundType]);

        const items = viewMode === 'main' ? mainItems : pickItems;

        const applyConfigUpdate = useCallback(
            async (partial: Partial<SoundConfig>) => {
                const previousConfig = configRef.current;
                const nextConfig: SoundConfig = { ...previousConfig, ...partial };

                setConfig(nextConfig);
                soundService?.setConfig(partial);

                if (!canPersistPreferences) {
                    setStatus(
                        'Updated for this session (run `dexto setup` to persist preferences).'
                    );
                    return;
                }

                try {
                    await updateGlobalPreferences({ sounds: partial });
                    setStatus('Saved preferences.');
                } catch (err) {
                    setConfig(previousConfig);
                    soundService?.setConfig(previousConfig);
                    setError(err instanceof Error ? err.message : String(err));
                }
            },
            [canPersistPreferences, soundService]
        );

        const setBuiltinSound = useCallback(
            async (soundType: SoundType, soundId: string) => {
                const soundsDir = getDextoGlobalPath('sounds');
                await fs.mkdir(soundsDir, { recursive: true });

                const builtin = builtinSoundPaths.find((s) => s.id === soundId);
                if (!builtin) {
                    throw new Error(`Unknown built-in sound: ${soundId}`);
                }

                // Ensure only one custom file exists for this sound type
                await removeCustomSoundFiles(soundType);

                const destPath = path.join(soundsDir, `${soundType}${builtin.destExt}`);
                await fs.copyFile(builtin.absPath, destPath);

                await refreshSelections();
                playNotificationSound(soundType);
                setStatus(`Set ${soundType} sound to: ${builtin.name}`);
            },
            [builtinSoundPaths, refreshSelections]
        );

        const setSystemDefaultSound = useCallback(
            async (soundType: SoundType) => {
                await removeCustomSoundFiles(soundType);
                await refreshSelections();
                playNotificationSound(soundType);
                setStatus(`Reset ${soundType} sound to system default.`);
            },
            [refreshSelections]
        );

        const resetAllCustomSounds = useCallback(async () => {
            await Promise.all([
                removeCustomSoundFiles('approval'),
                removeCustomSoundFiles('complete'),
            ]);
            await refreshSelections();
            setStatus('Reset custom sounds to system defaults.');
        }, [refreshSelections]);

        const handleSelect = useCallback(
            async (item: MainItem | PickItem) => {
                if (isApplying || isLoading) return;
                setIsApplying(true);
                setError(null);
                setStatus(null);

                try {
                    if (item.type === 'toggle') {
                        const nextValue = !configRef.current[item.id];
                        await applyConfigUpdate(soundConfigUpdate(item.id, nextValue));
                        return;
                    }

                    if (item.type === 'pick') {
                        setViewMode(item.id);
                        setSelectedIndex(0);
                        return;
                    }

                    if (item.type === 'action') {
                        if (item.id === 'test-approval') {
                            playNotificationSound('approval');
                            setStatus('Played approval sound.');
                            return;
                        }
                        if (item.id === 'test-complete') {
                            playNotificationSound('complete');
                            setStatus('Played completion sound.');
                            return;
                        }
                        if (item.id === 'reset-custom') {
                            await resetAllCustomSounds();
                            return;
                        }
                        if (item.id === 'show-folder') {
                            setStatus(`Sounds folder: ${getDextoGlobalPath('sounds')}`);
                            return;
                        }
                    }

                    if (item.type === 'system-default') {
                        if (!pickSoundType) return;
                        await setSystemDefaultSound(pickSoundType);
                        setViewMode('main');
                        setSelectedIndex(0);
                        return;
                    }

                    if (item.type === 'builtin') {
                        if (!pickSoundType) return;
                        await setBuiltinSound(pickSoundType, item.id);
                        setViewMode('main');
                        setSelectedIndex(0);
                        return;
                    }
                } finally {
                    setIsApplying(false);
                }
            },
            [
                applyConfigUpdate,
                isApplying,
                isLoading,
                pickSoundType,
                resetAllCustomSounds,
                setBuiltinSound,
                setSystemDefaultSound,
            ]
        );

        const formatItem = useCallback(
            (item: MainItem | PickItem, isSelected: boolean) => {
                if ('type' in item && item.type === 'toggle') {
                    const marker = item.value ? '✓' : ' ';
                    return (
                        <>
                            <Text>{item.icon} </Text>
                            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                [{marker}] {item.label}
                            </Text>
                            <Text color={isSelected ? 'white' : 'gray'}> - {item.description}</Text>
                        </>
                    );
                }

                if ('type' in item && item.type === 'pick') {
                    return (
                        <>
                            <Text>{item.icon} </Text>
                            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                {item.label}
                            </Text>
                            <Text color={isSelected ? 'white' : 'gray'}> - {item.description}</Text>
                        </>
                    );
                }

                if ('type' in item && item.type === 'action') {
                    return (
                        <>
                            <Text>{item.icon} </Text>
                            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                {item.label}
                            </Text>
                            <Text color={isSelected ? 'white' : 'gray'}> - {item.description}</Text>
                        </>
                    );
                }

                if ('type' in item && item.type === 'system-default') {
                    const isCurrent =
                        pickSoundType === 'approval'
                            ? approvalSelection.kind === 'system'
                            : pickSoundType === 'complete'
                              ? completeSelection.kind === 'system'
                              : false;
                    return (
                        <>
                            <Text>🖥️ </Text>
                            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                {item.label}
                            </Text>
                            <Text color={isSelected ? 'white' : 'gray'}> - {item.description}</Text>
                            {isCurrent && (
                                <Text color="green" bold>
                                    {' '}
                                    ✓
                                </Text>
                            )}
                        </>
                    );
                }

                if ('type' in item && item.type === 'builtin') {
                    return (
                        <>
                            <Text>🎮 </Text>
                            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                {item.label}
                            </Text>
                            <Text color={isSelected ? 'white' : 'gray'}> - {item.description}</Text>
                            {item.isCurrent && (
                                <Text color="green" bold>
                                    {' '}
                                    ✓
                                </Text>
                            )}
                        </>
                    );
                }

                return null;
            },
            [approvalSelection.kind, completeSelection.kind, pickSoundType]
        );

        const title =
            viewMode === 'main'
                ? 'Sounds'
                : pickSoundType === 'approval'
                  ? 'Select Approval Sound'
                  : 'Select Completion Sound';

        return (
            <Box flexDirection="column">
                <BaseSelector
                    ref={baseSelectorRef}
                    items={items}
                    isVisible={isVisible}
                    isLoading={isLoading}
                    loadingMessage="Loading sound settings..."
                    selectedIndex={selectedIndex}
                    onSelectIndex={setSelectedIndex}
                    onSelect={(item) => void handleSelect(item as MainItem | PickItem)}
                    onClose={closeOrBack}
                    formatItem={formatItem}
                    title={title}
                    borderColor="magenta"
                    emptyMessage="No options available"
                />

                <Box marginTop={1} flexDirection="column">
                    {!canPersistPreferences && (
                        <Text color="yellow">
                            ⚠️ Preferences file not found. Toggle changes won't persist (run `dexto
                            setup`).
                        </Text>
                    )}
                    {isApplying && <Text color="gray">Applying…</Text>}
                    {status && <Text color="green">✅ {status}</Text>}
                    {error && <Text color="red">❌ {error}</Text>}
                    {!status && !error && !isApplying && (
                        <Text color="gray">
                            Tip: Built-in sounds are copied to {getDextoGlobalPath('sounds')}
                        </Text>
                    )}
                </Box>
            </Box>
        );
    }
);

export default SoundsSelector;
