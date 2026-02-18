/**
 * SoundsSelector Component
 * Interactive overlay for configuring sound notifications and selecting built-in sounds.
 *
 * Built-in sounds are copied into ~/.dexto/sounds/ as:
 * - startup.wav
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
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Key } from '../../hooks/useInputOrchestrator.js';
import { BaseSelector, type BaseSelectorHandle } from '../base/BaseSelector.js';
import {
    CUSTOM_SOUND_EXTENSIONS,
    getDefaultSoundSpec,
    getCustomSoundPath,
    playNotificationSound,
    playSoundFile,
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
    filename: string;
}

const BUILTIN_SOUNDS: BuiltinSound[] = [
    {
        id: 'blow',
        name: 'Blow',
        filename: 'blow.wav',
    },
    {
        id: 'coin',
        name: 'Coin',
        filename: 'coin.wav',
    },
    {
        id: 'confirm',
        name: 'Confirm',
        filename: 'confirm.wav',
    },
    {
        id: 'ping',
        name: 'Ping',
        filename: 'ping.wav',
    },
    {
        id: 'powerup',
        name: 'Power Up',
        filename: 'powerup.wav',
    },
    {
        id: 'chime',
        name: 'Chime',
        filename: 'chime.wav',
    },
    {
        id: 'levelup',
        name: 'Level Up',
        filename: 'levelup.wav',
    },
    {
        id: 'boot',
        name: 'Boot',
        filename: 'boot.wav',
    },
    {
        id: 'startup',
        name: 'Startup',
        filename: 'startup.wav',
    },
    {
        id: 'glass',
        name: 'Glass',
        filename: 'glass.wav',
    },
    {
        id: 'success',
        name: 'Success',
        filename: 'success.wav',
    },
    {
        id: 'win',
        name: 'Win',
        filename: 'win.wav',
    },
    {
        id: 'treasure',
        name: 'Treasure Chest',
        filename: 'treasure.wav',
    },
];

type SoundSelection = { kind: 'system' } | { kind: 'builtin'; id: string } | { kind: 'custom' };

type ViewMode = 'main' | 'pick-startup' | 'pick-approval' | 'pick-complete';

type MainItem =
    | { type: 'enabled'; id: 'enabled' }
    | {
          type: 'pick';
          id: 'pick-startup' | 'pick-approval' | 'pick-complete';
          soundType: SoundType;
          label: string;
      };

type PickItem =
    | { type: 'default'; id: 'default'; label: string; isCurrent: boolean }
    | { type: 'builtin'; id: string; label: string; isCurrent: boolean };

function isPickItem(item: MainItem | PickItem): item is PickItem {
    return item.type === 'default' || item.type === 'builtin';
}

const DEFAULT_CONFIG: SoundConfig = {
    enabled: true,
    onStartup: true,
    onApprovalRequired: true,
    onTaskComplete: true,
};

function selectionLabel(
    soundType: SoundType,
    selection: SoundSelection,
    builtinSounds: ReadonlyArray<Pick<BuiltinSound, 'id' | 'name'>>
): string {
    if (selection.kind === 'system') return soundType === 'startup' ? 'Startup' : 'System';
    if (selection.kind === 'custom') return 'Custom';
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
        const applyConfigUpdateRef = useRef<(partial: Partial<SoundConfig>) => Promise<void>>(
            async () => {}
        );
        const pickItemsRef = useRef<PickItem[]>([]);
        const previewPickItemRef = useRef<(item: PickItem) => void>(() => {});

        const [viewMode, setViewMode] = useState<ViewMode>('main');
        const [selectedIndex, setSelectedIndex] = useState(0);
        const [isLoading, setIsLoading] = useState(false);
        const [isApplying, setIsApplying] = useState(false);
        const [error, setError] = useState<string | null>(null);
        const [canPersistPreferences, setCanPersistPreferences] = useState(false);
        const [config, setConfig] = useState<SoundConfig>(DEFAULT_CONFIG);
        const [approvalSelection, setApprovalSelection] = useState<SoundSelection>({
            kind: 'system',
        });
        const [completeSelection, setCompleteSelection] = useState<SoundSelection>({
            kind: 'system',
        });
        const [startupSelection, setStartupSelection] = useState<SoundSelection>({
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
            setError(null);
        }, [onClose, viewMode]);

        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    if (!isVisible) return false;

                    // Main view: allow ←/→ to toggle the master sounds setting (On/Off)
                    if (viewMode === 'main' && selectedIndex === 0) {
                        if (key.leftArrow || key.rightArrow) {
                            const nextEnabled = Boolean(key.rightArrow);
                            if (configRef.current.enabled !== nextEnabled) {
                                void applyConfigUpdateRef.current({ enabled: nextEnabled });
                            }
                            return true;
                        }
                    }

                    // Pick view: allow Space to preview the selected sound
                    if (viewMode !== 'main' && input === ' ') {
                        const item = pickItemsRef.current[selectedIndex];
                        if (item) {
                            previewPickItemRef.current(item);
                        }
                        return true;
                    }

                    return baseSelectorRef.current?.handleInput(input, key) ?? false;
                },
            }),
            [isVisible, selectedIndex, viewMode]
        );

        const builtinSoundPaths = useMemo(() => {
            return BUILTIN_SOUNDS.map((sound) => ({
                ...sound,
                absPath: fileURLToPath(
                    new URL(`../../../assets/sounds/${sound.filename}`, import.meta.url)
                ),
            }));
        }, []);

        const refreshSelections = useCallback(async () => {
            const builtinBuffers = builtinBuffersRef.current;
            const [nextStartup, nextApproval, nextComplete] = await Promise.all([
                resolveSelection('startup', builtinBuffers),
                resolveSelection('approval', builtinBuffers),
                resolveSelection('complete', builtinBuffers),
            ]);
            setStartupSelection(nextStartup);
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
                            onStartup: preferences.sounds?.onStartup ?? nextConfig.onStartup,
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

        const mainItems: MainItem[] = useMemo(
            () => [
                { type: 'enabled', id: 'enabled' },
                {
                    type: 'pick',
                    id: 'pick-startup',
                    soundType: 'startup',
                    label: 'startup sound',
                },
                {
                    type: 'pick',
                    id: 'pick-approval',
                    soundType: 'approval',
                    label: 'approval sound',
                },
                {
                    type: 'pick',
                    id: 'pick-complete',
                    soundType: 'complete',
                    label: 'completion sound',
                },
            ],
            []
        );

        const pickSoundType: SoundType | null =
            viewMode === 'pick-startup'
                ? 'startup'
                : viewMode === 'pick-approval'
                  ? 'approval'
                  : viewMode === 'pick-complete'
                    ? 'complete'
                    : null;

        const pickItems: PickItem[] = useMemo(() => {
            if (!pickSoundType) return [];

            const current =
                pickSoundType === 'startup'
                    ? startupSelection
                    : pickSoundType === 'approval'
                      ? approvalSelection
                      : completeSelection;

            const items: PickItem[] = [
                {
                    type: 'default',
                    id: 'default',
                    label: 'Default',
                    isCurrent: current.kind === 'system',
                },
                ...builtinSoundPaths.map((sound) => ({
                    type: 'builtin' as const,
                    id: sound.id,
                    label: sound.name,
                    isCurrent: current.kind === 'builtin' && current.id === sound.id,
                })),
            ];

            return items;
        }, [
            approvalSelection,
            builtinSoundPaths,
            completeSelection,
            pickSoundType,
            startupSelection,
        ]);

        pickItemsRef.current = pickItems;

        const items = viewMode === 'main' ? mainItems : pickItems;

        const applyConfigUpdate = useCallback(
            async (partial: Partial<SoundConfig>) => {
                const previousConfig = configRef.current;
                const nextConfig: SoundConfig = { ...previousConfig, ...partial };

                setConfig(nextConfig);
                soundService?.setConfig(partial);

                if (!canPersistPreferences) {
                    return;
                }

                try {
                    await updateGlobalPreferences({ sounds: partial });
                } catch (err) {
                    setConfig(previousConfig);
                    soundService?.setConfig(previousConfig);
                    setError(err instanceof Error ? err.message : String(err));
                }
            },
            [canPersistPreferences, soundService]
        );

        applyConfigUpdateRef.current = applyConfigUpdate;

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

                const destPath = path.join(soundsDir, `${soundType}.wav`);
                await fs.copyFile(builtin.absPath, destPath);

                await refreshSelections();
                playNotificationSound(soundType);
            },
            [builtinSoundPaths, refreshSelections]
        );

        const setSystemDefaultSound = useCallback(
            async (soundType: SoundType) => {
                await removeCustomSoundFiles(soundType);
                await refreshSelections();
                playNotificationSound(soundType);
            },
            [refreshSelections]
        );

        const previewPickItem = useCallback(
            (item: PickItem) => {
                if (!pickSoundType) return;

                if (item.type === 'default') {
                    const spec = getDefaultSoundSpec(pickSoundType);
                    if (spec) playSoundFile(spec);
                    return;
                }

                const builtin = builtinSoundPaths.find((s) => s.id === item.id);
                if (builtin) {
                    playSoundFile(builtin.absPath);
                }
            },
            [builtinSoundPaths, pickSoundType]
        );

        previewPickItemRef.current = previewPickItem;

        const handleSelect = useCallback(
            async (item: MainItem | PickItem) => {
                if (isApplying || isLoading) return;
                setIsApplying(true);
                setError(null);

                try {
                    if (item.type === 'enabled') {
                        await applyConfigUpdate({ enabled: !configRef.current.enabled });
                        return;
                    }

                    if (item.type === 'pick') {
                        setViewMode(item.id);
                        setSelectedIndex(0);
                        return;
                    }

                    if (item.type === 'default') {
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
                setBuiltinSound,
                setSystemDefaultSound,
            ]
        );

        const formatItem = useCallback(
            (item: MainItem | PickItem, isSelected: boolean) => {
                if (item.type === 'enabled') {
                    return (
                        <>
                            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                sounds:{' '}
                            </Text>
                            <Text inverse={config.enabled} bold={config.enabled}>
                                On
                            </Text>
                            <Text> </Text>
                            <Text inverse={!config.enabled} bold={!config.enabled}>
                                Off
                            </Text>
                        </>
                    );
                }

                if (item.type === 'pick') {
                    const selection =
                        item.soundType === 'startup'
                            ? startupSelection
                            : item.soundType === 'approval'
                              ? approvalSelection
                              : completeSelection;
                    const currentLabel = selectionLabel(
                        item.soundType,
                        selection,
                        builtinSoundPaths
                    );

                    return (
                        <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                            {item.label}: {currentLabel}
                        </Text>
                    );
                }

                if (item.type === 'default' || item.type === 'builtin') {
                    return (
                        <>
                            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                {item.label}
                            </Text>
                            {item.isCurrent && <Text color="green"> *</Text>}
                        </>
                    );
                }

                return null;
            },
            [
                approvalSelection,
                builtinSoundPaths,
                completeSelection,
                config.enabled,
                startupSelection,
            ]
        );

        const title =
            viewMode === 'main'
                ? 'Sounds'
                : pickSoundType === 'startup'
                  ? 'Select Startup Sound'
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
                    onTab={(item) => {
                        if (isPickItem(item as MainItem | PickItem)) {
                            previewPickItem(item as PickItem);
                        }
                    }}
                    supportsTab={viewMode !== 'main'}
                    onClose={closeOrBack}
                    formatItem={formatItem}
                    title={title}
                    instructionsOverride={
                        viewMode === 'main'
                            ? '↑↓ navigate, ←→ toggle, Enter select, Esc close'
                            : '↑↓ navigate, Tab/Space preview, Enter select, Esc back'
                    }
                    borderColor="magenta"
                    emptyMessage="No options available"
                />

                {error && (
                    <Box marginTop={1}>
                        <Text color="red">{error}</Text>
                    </Box>
                )}
            </Box>
        );
    }
);

export default SoundsSelector;
