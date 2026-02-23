/**
 * SoundsSelector Component
 * Interactive overlay for configuring sound notifications and selecting built-in sounds.
 *
 * Built-in sounds are copied into the Dexto sounds directory (typically ~/.dexto/sounds/builtins/)
 * and selected via preferences.yml using paths relative to that directory (e.g., builtins/coin.wav).
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
    | { type: 'builtin'; id: string; label: string; isCurrent: boolean }
    | { type: 'file'; id: string; relativePath: string; label: string; isCurrent: boolean };

const DEFAULT_CONFIG: SoundConfig = {
    enabled: true,
    onStartup: false,
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

    return normalizedRelative.replace(/\.[^/.]+$/, '');
}

function getAllowedCustomSoundExtensions(): ReadonlySet<string> {
    switch (process.platform) {
        case 'win32':
            return new Set(['.wav']);
        case 'linux':
            return new Set(['.wav', '.ogg', '.oga']);
        default:
            return new Set(CUSTOM_SOUND_EXTENSIONS);
    }
}

async function listCustomSoundFiles(soundsDir: string): Promise<string[]> {
    const allowedExtensions = getAllowedCustomSoundExtensions();
    const results: string[] = [];

    const walk = async (dir: string): Promise<void> => {
        let entries: Array<import('node:fs').Dirent>;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            throw error;
        }

        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;

            const absPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                if (dir === soundsDir && entry.name === 'builtins') continue;
                await walk(absPath);
                continue;
            }

            if (!entry.isFile()) continue;

            const ext = path.extname(entry.name).toLowerCase();
            if (!allowedExtensions.has(ext)) continue;

            const relative = path.relative(soundsDir, absPath);
            if (relative.startsWith('..') || path.isAbsolute(relative)) continue;

            results.push(relative.split(path.sep).join('/'));
        }
    };

    await walk(soundsDir);

    return results.sort((a, b) => a.localeCompare(b));
}

function formatCustomSoundLabel(relativePath: string): string {
    return relativePath.replaceAll('\\', '/').replace(/\.[^/.]+$/, '');
}

function resolveSelection(soundType: SoundType, config: SoundConfig): SoundSelection {
    const configuredRelativePath = config[getSoundFileKey(soundType)];
    if (configuredRelativePath) {
        return { kind: 'file', relativePath: configuredRelativePath };
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
        const [customSoundFiles, setCustomSoundFiles] = useState<string[]>([]);
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

                const soundsDir = getDextoGlobalPath('sounds');
                try {
                    const files = await listCustomSoundFiles(soundsDir);
                    if (!cancelled) setCustomSoundFiles(files);
                } catch (err) {
                    if (!cancelled) {
                        setCustomSoundFiles([]);
                        setError(
                            `Failed to load custom sounds: ${err instanceof Error ? err.message : String(err)}`
                        );
                    }
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
        }, [isVisible, refreshSelections, soundService]);

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
                ...customSoundFiles.map((relativePath) => ({
                    type: 'file' as const,
                    id: relativePath,
                    relativePath,
                    label: formatCustomSoundLabel(relativePath),
                    isCurrent:
                        isEnabled && normalizedRelative === relativePath.replaceAll('\\', '/'),
                })),
            ];

            return items;
        }, [
            approvalSelection,
            builtinSoundPaths,
            customSoundFiles,
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

                if (item.type === 'builtin') {
                    const builtin = builtinSoundPaths.find((s) => s.id === item.id);
                    if (builtin) {
                        playSoundFile(builtin.absPath);
                    }
                    return;
                }

                if (item.type === 'file') {
                    const soundsDir = path.normalize(getDextoGlobalPath('sounds'));
                    const resolved = path.normalize(path.resolve(soundsDir, item.relativePath));
                    if (resolved === soundsDir || resolved.startsWith(soundsDir + path.sep)) {
                        playSoundFile(resolved);
                    }
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

                    if (
                        item.type === 'off' ||
                        item.type === 'default' ||
                        item.type === 'builtin' ||
                        item.type === 'file'
                    ) {
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
                            const partial: Partial<SoundConfig> = {
                                [enabledKey]: true,
                                [fileKey]: undefined,
                            };
                            await applyConfigUpdate(partial);
                            playNotificationSound(pickSoundType, {
                                ...configRef.current,
                                ...partial,
                            });
                        } else if (item.type === 'builtin') {
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
                        } else {
                            const partial: Partial<SoundConfig> = {
                                [enabledKey]: true,
                                [fileKey]: item.relativePath,
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
                } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
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
                        <Text wrap="truncate-end">
                            <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                sounds:{' '}
                            </Text>
                            <Text color={config.enabled ? 'green' : 'gray'} bold={isSelected}>
                                {config.enabled ? 'On' : 'Off'}
                            </Text>
                        </Text>
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
                        <Text
                            color={isSelected ? 'cyan' : 'gray'}
                            bold={isSelected}
                            wrap="truncate-end"
                        >
                            {item.label}: {currentLabel}
                        </Text>
                    );
                }

                if (
                    item.type === 'off' ||
                    item.type === 'default' ||
                    item.type === 'builtin' ||
                    item.type === 'file'
                ) {
                    return (
                        <Box flexDirection="row">
                            <Box flexGrow={1} flexDirection="row">
                                <Text color="green">{item.isCurrent ? '* ' : '  '}</Text>
                                <Text
                                    color={isSelected ? 'cyan' : 'gray'}
                                    bold={isSelected}
                                    wrap="truncate-end"
                                >
                                    {item.label}
                                </Text>
                            </Box>
                            {isSelected && (
                                <Box flexDirection="row" marginLeft={1}>
                                    <Text
                                        inverse={pickAction === 'listen'}
                                        bold={pickAction === 'listen'}
                                    >
                                        {' '}
                                        Listen{' '}
                                    </Text>
                                    <Text> </Text>
                                    <Text
                                        inverse={pickAction === 'select'}
                                        bold={pickAction === 'select'}
                                    >
                                        {' '}
                                        Select{' '}
                                    </Text>
                                </Box>
                            )}
                        </Box>
                    );
                }

                return null;
            },
            [approvalSelection, completeSelection, config, pickAction, startupSelection]
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
                            ? '↑↓ navigate • Enter toggle/select • Esc close'
                            : `↑↓ navigate • ←/→ Listen/Select • Enter ${pickAction === 'listen' ? 'preview' : 'select'} • Esc back`
                    }
                    borderColor="magenta"
                    emptyMessage="No options available"
                />

                {error && (
                    <Box marginTop={1}>
                        <Text color="red" wrap="wrap">
                            {error}
                        </Text>
                    </Box>
                )}
            </Box>
        );
    }
);

export default SoundsSelector;
