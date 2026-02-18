/**
 * SoundsSelector Component
 * Interactive overlay for configuring sound notifications and selecting built-in sounds.
 *
 * Built-in sounds are copied into ~/.dexto/sounds/builtins/ and selected via preferences.yml
 * using paths relative to ~/.dexto/sounds (e.g., builtins/coin.wav).
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

type SoundSelection = { kind: 'system' } | { kind: 'file'; relativePath: string };

type ViewMode = 'main' | 'pick-startup' | 'pick-approval' | 'pick-complete';
type PickAction = 'listen' | 'select';

type MainItem =
    | { type: 'enabled'; id: 'enabled' }
    | {
          type: 'pick';
          id: 'pick-startup' | 'pick-approval' | 'pick-complete';
          soundType: SoundType;
          label: string;
      };

type PickItem =
    | { type: 'off'; id: 'off'; label: string; isCurrent: boolean }
    | { type: 'default'; id: 'default'; label: string; isCurrent: boolean }
    | { type: 'builtin'; id: string; label: string; isCurrent: boolean };

const DEFAULT_CONFIG: SoundConfig = {
    enabled: true,
    onStartup: true,
    onApprovalRequired: true,
    onTaskComplete: true,
};

function getSoundEnabledKey(
    soundType: SoundType
): 'onStartup' | 'onApprovalRequired' | 'onTaskComplete' {
    switch (soundType) {
        case 'startup':
            return 'onStartup';
        case 'approval':
            return 'onApprovalRequired';
        case 'complete':
            return 'onTaskComplete';
    }
}

function getSoundFileKey(
    soundType: SoundType
): 'startupSoundFile' | 'approvalSoundFile' | 'completeSoundFile' {
    switch (soundType) {
        case 'startup':
            return 'startupSoundFile';
        case 'approval':
            return 'approvalSoundFile';
        case 'complete':
            return 'completeSoundFile';
    }
}

function selectionLabel(soundType: SoundType, selection: SoundSelection): string {
    if (selection.kind === 'system') return soundType === 'startup' ? 'Startup' : 'System';

    const normalizedRelative = selection.relativePath.replaceAll('\\', '/');
    const builtinFilename = normalizedRelative.startsWith('builtins/')
        ? normalizedRelative.slice('builtins/'.length)
        : null;
    if (builtinFilename) {
        const builtin = BUILTIN_SOUNDS.find((s) => s.filename === builtinFilename);
        if (builtin) return builtin.name;
    }

    return path.parse(normalizedRelative).name;
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

function resolveSelection(soundType: SoundType, config: SoundConfig): SoundSelection {
    const configuredRelativePath = config[getSoundFileKey(soundType)];
    if (configuredRelativePath) {
        return { kind: 'file', relativePath: configuredRelativePath };
    }

    const legacyCustomPath = getCustomSoundPath(soundType);
    if (legacyCustomPath) {
        const soundsDir = getDextoGlobalPath('sounds');
        const relative = path.relative(soundsDir, legacyCustomPath);
        const normalized =
            relative.startsWith('..') || path.isAbsolute(relative)
                ? path.basename(legacyCustomPath)
                : relative.split(path.sep).join('/');
        return { kind: 'file', relativePath: normalized };
    }

    return { kind: 'system' };
}

const SoundsSelector = forwardRef<SoundsSelectorHandle, SoundsSelectorProps>(
    function SoundsSelector({ isVisible, onClose }, ref) {
        const soundService = useSoundService();

        const baseSelectorRef = useRef<BaseSelectorHandle>(null);

        const [viewMode, setViewMode] = useState<ViewMode>('main');
        const [selectedIndex, setSelectedIndex] = useState(0);
        const [pickAction, setPickAction] = useState<PickAction>('listen');
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

                    if (viewMode !== 'main') {
                        if (key.leftArrow) {
                            setPickAction('listen');
                            return true;
                        }
                        if (key.rightArrow) {
                            setPickAction('select');
                            return true;
                        }
                    }

                    return baseSelectorRef.current?.handleInput(input, key) ?? false;
                },
            }),
            [isVisible, viewMode]
        );

        const builtinSoundPaths = useMemo(() => {
            return BUILTIN_SOUNDS.map((sound) => ({
                ...sound,
                absPath: fileURLToPath(
                    new URL(`../../../assets/sounds/${sound.filename}`, import.meta.url)
                ),
            }));
        }, []);

        const refreshSelections = useCallback((nextConfig: SoundConfig) => {
            setStartupSelection(resolveSelection('startup', nextConfig));
            setApprovalSelection(resolveSelection('approval', nextConfig));
            setCompleteSelection(resolveSelection('complete', nextConfig));
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
                            startupSoundFile: preferences.sounds?.startupSoundFile,
                            onApprovalRequired:
                                preferences.sounds?.onApprovalRequired ??
                                nextConfig.onApprovalRequired,
                            approvalSoundFile: preferences.sounds?.approvalSoundFile,
                            onTaskComplete:
                                preferences.sounds?.onTaskComplete ?? nextConfig.onTaskComplete,
                            completeSoundFile: preferences.sounds?.completeSoundFile,
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

                if (!cancelled) {
                    setConfig(nextConfig);
                    soundService?.setConfig(nextConfig);
                    refreshSelections(nextConfig);
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
            const enabledKey = getSoundEnabledKey(pickSoundType);
            const isEnabled = config[enabledKey];
            const normalizedRelative =
                current.kind === 'file' ? current.relativePath.replaceAll('\\', '/') : null;

            const items: PickItem[] = [
                {
                    type: 'off',
                    id: 'off',
                    label: 'Off',
                    isCurrent: !isEnabled,
                },
                {
                    type: 'default',
                    id: 'default',
                    label: 'Default',
                    isCurrent: isEnabled && current.kind === 'system',
                },
                ...builtinSoundPaths.map((sound) => ({
                    type: 'builtin' as const,
                    id: sound.id,
                    label: sound.name,
                    isCurrent:
                        isEnabled &&
                        normalizedRelative === path.posix.join('builtins', sound.filename),
                })),
            ];

            return items;
        }, [
            approvalSelection,
            builtinSoundPaths,
            completeSelection,
            config,
            pickSoundType,
            startupSelection,
        ]);

        const items = viewMode === 'main' ? mainItems : pickItems;

        const applyConfigUpdate = useCallback(
            async (partial: Partial<SoundConfig>) => {
                const previousConfig = configRef.current;
                const nextConfig: SoundConfig = { ...previousConfig, ...partial };

                setConfig(nextConfig);
                soundService?.setConfig(partial);
                refreshSelections(nextConfig);

                if (!canPersistPreferences) {
                    return;
                }

                try {
                    await updateGlobalPreferences({ sounds: partial });
                } catch (err) {
                    setConfig(previousConfig);
                    soundService?.setConfig(previousConfig);
                    refreshSelections(previousConfig);
                    setError(err instanceof Error ? err.message : String(err));
                }
            },
            [canPersistPreferences, refreshSelections, soundService]
        );

        const ensureBuiltinSoundFile = useCallback(
            async (soundId: string): Promise<string> => {
                const soundsDir = getDextoGlobalPath('sounds');
                const builtinsDir = path.join(soundsDir, 'builtins');
                await fs.mkdir(builtinsDir, { recursive: true });

                const builtin = builtinSoundPaths.find((s) => s.id === soundId);
                if (!builtin) {
                    throw new Error(`Unknown built-in sound: ${soundId}`);
                }

                const destPath = path.join(builtinsDir, builtin.filename);
                await fs.copyFile(builtin.absPath, destPath);

                return path.posix.join('builtins', builtin.filename);
            },
            [builtinSoundPaths]
        );

        const previewPickItem = useCallback(
            (item: PickItem) => {
                if (!pickSoundType) return;

                if (item.type === 'off') {
                    return;
                }

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
                        setPickAction('listen');
                        setViewMode(item.id);
                        setSelectedIndex(0);
                        return;
                    }

                    if (item.type === 'off' || item.type === 'default' || item.type === 'builtin') {
                        if (!pickSoundType) return;
                        const enabledKey = getSoundEnabledKey(pickSoundType);
                        const fileKey = getSoundFileKey(pickSoundType);

                        if (pickAction === 'listen') {
                            previewPickItem(item);
                            return;
                        }

                        if (item.type === 'off') {
                            await applyConfigUpdate({ [enabledKey]: false });
                            setViewMode('main');
                            setSelectedIndex(0);
                            return;
                        }

                        if (item.type === 'default') {
                            await removeCustomSoundFiles(pickSoundType);
                            const partial: Partial<SoundConfig> = {
                                [enabledKey]: true,
                                [fileKey]: undefined,
                            };
                            await applyConfigUpdate(partial);
                            playNotificationSound(pickSoundType, {
                                ...configRef.current,
                                ...partial,
                            });
                        } else {
                            const relativePath = await ensureBuiltinSoundFile(item.id);
                            const partial: Partial<SoundConfig> = {
                                [enabledKey]: true,
                                [fileKey]: relativePath,
                            };
                            await applyConfigUpdate(partial);
                            playNotificationSound(pickSoundType, {
                                ...configRef.current,
                                ...partial,
                            });
                        }

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
                pickAction,
                pickSoundType,
                previewPickItem,
                ensureBuiltinSoundFile,
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
                            <Text color={config.enabled ? 'green' : 'gray'} bold={isSelected}>
                                {config.enabled ? 'On' : 'Off'}
                            </Text>
                        </>
                    );
                }

                if (item.type === 'pick') {
                    const enabled =
                        item.soundType === 'startup'
                            ? config.onStartup
                            : item.soundType === 'approval'
                              ? config.onApprovalRequired
                              : config.onTaskComplete;
                    const selection =
                        item.soundType === 'startup'
                            ? startupSelection
                            : item.soundType === 'approval'
                              ? approvalSelection
                              : completeSelection;
                    const currentLabel = enabled
                        ? selectionLabel(item.soundType, selection)
                        : 'Off';

                    return (
                        <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                            {item.label}: {currentLabel}
                        </Text>
                    );
                }

                if (item.type === 'off' || item.type === 'default' || item.type === 'builtin') {
                    return (
                        <>
                            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                {item.label}
                            </Text>
                            {item.isCurrent && <Text color="green"> *</Text>}
                            {isSelected && (
                                <>
                                    <Text> </Text>
                                    <Text
                                        inverse={pickAction === 'listen'}
                                        bold={pickAction === 'listen'}
                                    >
                                        Listen
                                    </Text>
                                    <Text> </Text>
                                    <Text
                                        inverse={pickAction === 'select'}
                                        bold={pickAction === 'select'}
                                    >
                                        Select
                                    </Text>
                                </>
                            )}
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
                pickAction,
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
                    onClose={closeOrBack}
                    formatItem={formatItem}
                    title={title}
                    instructionsOverride={
                        viewMode === 'main'
                            ? '↑↓ navigate, Enter toggle/select, Esc close'
                            : '↑↓ navigate, ←→ Listen/Select, Enter run, Esc back'
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
