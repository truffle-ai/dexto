/**
 * LocalModelWizard Component
 * Specialized wizard for adding local GGUF models with:
 * - Registry model selection with download support
 * - Custom GGUF file path option
 * - Download progress display
 */

import React, { useState, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Box, Text } from 'ink';
import * as fs from 'fs';
import * as path from 'path';
import type { Key } from '../../../hooks/useInputOrchestrator.js';
import {
    saveCustomModel,
    getAllInstalledModels,
    addInstalledModel,
    getModelsDirectory,
    formatSize,
    type InstalledModel,
    type CustomModel,
} from '@dexto/agent-management';
import {
    getAllLocalModels,
    getLocalModelById,
    getRecommendedLocalModels,
    downloadModel,
    isNodeLlamaCppInstalled,
    type LocalModelInfo,
    type ModelDownloadProgress,
} from '@dexto/core';
import { SetupInfoBanner } from './shared/index.js';

type WizardStep = 'select-model' | 'custom-path' | 'display-name' | 'downloading';

interface LocalModelWizardProps {
    isVisible: boolean;
    onComplete: (model: CustomModel) => void;
    onClose: () => void;
}

export interface LocalModelWizardHandle {
    handleInput: (input: string, key: Key) => boolean;
}

interface ModelOption {
    id: string;
    name: string;
    description: string;
    sizeBytes: number;
    isInstalled: boolean;
    minVRAM: number | undefined;
}

const MAX_VISIBLE_ITEMS = 8;

/**
 * Specialized wizard for local GGUF model setup.
 * Similar UX to CLI setup flow but in Ink.
 */
const LocalModelWizard = forwardRef<LocalModelWizardHandle, LocalModelWizardProps>(
    function LocalModelWizard({ isVisible, onComplete, onClose }, ref) {
        const [step, setStep] = useState<WizardStep>('select-model');
        const [models, setModels] = useState<ModelOption[]>([]);
        const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
        const [selectedIndex, setSelectedIndex] = useState(0);
        const [scrollOffset, setScrollOffset] = useState(0);
        const [showAllModels, setShowAllModels] = useState(false);
        const [isLoading, setIsLoading] = useState(true);
        const [error, setError] = useState<string | null>(null);
        const [nodeLlamaInstalled, setNodeLlamaInstalled] = useState(true);

        // Custom path input state
        const [customPath, setCustomPath] = useState('');

        // Display name input state
        const [displayName, setDisplayName] = useState('');
        const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
        const [selectedModelPath, setSelectedModelPath] = useState<string | null>(null);

        // Download state
        const [downloadProgress, setDownloadProgress] = useState<ModelDownloadProgress | null>(
            null
        );
        const [downloadError, setDownloadError] = useState<string | null>(null);

        // Reset state when becoming visible
        useEffect(() => {
            if (!isVisible) return;

            setStep('select-model');
            setSelectedIndex(0);
            setScrollOffset(0);
            setShowAllModels(false);
            setCustomPath('');
            setDisplayName('');
            setSelectedModelId(null);
            setSelectedModelPath(null);
            setDownloadProgress(null);
            setDownloadError(null);
            setError(null);
        }, [isVisible]);

        // Load models when visible or when showAllModels changes
        useEffect(() => {
            if (!isVisible) return;

            let cancelled = false;

            const loadData = async () => {
                setIsLoading(true);

                try {
                    // Check if node-llama-cpp is installed
                    const installed = await isNodeLlamaCppInstalled();
                    if (!cancelled) {
                        setNodeLlamaInstalled(installed);
                    }

                    // Get installed models
                    const installedModels = await getAllInstalledModels();
                    const installedSet = new Set(installedModels.map((m) => m.id));
                    if (!cancelled) {
                        setInstalledIds(installedSet);
                    }

                    // Get registry models based on showAllModels flag
                    const registryModels = showAllModels
                        ? getAllLocalModels()
                        : getRecommendedLocalModels();

                    const options: ModelOption[] = registryModels.map((m) => ({
                        id: m.id,
                        name: m.name,
                        description: m.description,
                        sizeBytes: m.sizeBytes,
                        isInstalled: installedSet.has(m.id),
                        minVRAM: m.minVRAM,
                    }));

                    if (!cancelled) {
                        setModels(options);
                        setIsLoading(false);
                    }
                } catch (err) {
                    if (!cancelled) {
                        setError(err instanceof Error ? err.message : 'Failed to load models');
                        setIsLoading(false);
                    }
                }
            };

            void loadData();

            return () => {
                cancelled = true;
            };
        }, [isVisible, showAllModels]);

        // Calculate scroll offset
        useEffect(() => {
            const itemCount = models.length + 3; // +3 for special options
            if (selectedIndex < scrollOffset) {
                setScrollOffset(selectedIndex);
            } else if (selectedIndex >= scrollOffset + MAX_VISIBLE_ITEMS) {
                setScrollOffset(
                    Math.min(selectedIndex - MAX_VISIBLE_ITEMS + 1, itemCount - MAX_VISIBLE_ITEMS)
                );
            }
        }, [selectedIndex, models.length, scrollOffset]);

        // Handle model selection
        const handleSelectModel = useCallback(
            async (modelId: string) => {
                // Check if already installed
                if (installedIds.has(modelId)) {
                    // Just save as custom model and complete
                    const modelInfo = getLocalModelById(modelId);
                    const model: CustomModel = {
                        name: modelId,
                        provider: 'local',
                        displayName: modelInfo?.name || modelId,
                    };
                    try {
                        await saveCustomModel(model);
                        onComplete(model);
                    } catch (err) {
                        setError(err instanceof Error ? err.message : 'Failed to save model');
                    }
                    return;
                }

                // Need to download - start download
                setSelectedModelId(modelId);
                setStep('downloading');
                setDownloadProgress(null);
                setDownloadError(null);

                try {
                    const result = await downloadModel(modelId, {
                        targetDir: getModelsDirectory(),
                        events: {
                            onProgress: (progress: ModelDownloadProgress) => {
                                setDownloadProgress(progress);
                            },
                            onComplete: () => {
                                // Download complete
                            },
                            onError: (_id: string, err: Error) => {
                                setDownloadError(err.message);
                            },
                        },
                    });

                    // Register the installed model
                    const modelInfo = getLocalModelById(modelId);
                    const installedModel: InstalledModel = {
                        id: modelId,
                        filePath: result.filePath,
                        sizeBytes: result.sizeBytes,
                        downloadedAt: new Date().toISOString(),
                        source: 'huggingface',
                        filename: modelInfo?.filename || path.basename(result.filePath),
                    };

                    if (result.sha256) {
                        installedModel.sha256 = result.sha256;
                    }

                    await addInstalledModel(installedModel);

                    // Save as custom model and complete
                    const model: CustomModel = {
                        name: modelId,
                        provider: 'local',
                        displayName: modelInfo?.name || modelId,
                    };
                    await saveCustomModel(model);
                    onComplete(model);
                } catch (err) {
                    setDownloadError(err instanceof Error ? err.message : 'Download failed');
                }
            },
            [installedIds, onComplete]
        );

        // Handle custom path submission
        const handleCustomPathSubmit = useCallback(async () => {
            const trimmedPath = customPath.trim();

            // Validate path
            if (!trimmedPath) {
                setError('File path is required');
                return;
            }

            if (!trimmedPath.toLowerCase().endsWith('.gguf')) {
                setError('File must have .gguf extension');
                return;
            }

            // Expand ~ to home directory
            const expandedPath = trimmedPath.startsWith('~')
                ? trimmedPath.replace('~', process.env.HOME || '')
                : trimmedPath;

            if (!path.isAbsolute(expandedPath)) {
                setError('Please enter an absolute path (starting with / or ~)');
                return;
            }

            if (!fs.existsSync(expandedPath)) {
                setError(`File not found: ${trimmedPath}`);
                return;
            }

            // Path is valid - move to display name step
            setSelectedModelPath(expandedPath);
            const filename = path.basename(expandedPath, '.gguf');
            setDisplayName(filename);
            setStep('display-name');
            setError(null);
        }, [customPath]);

        // Handle display name submission
        const handleDisplayNameSubmit = useCallback(async () => {
            if (!selectedModelPath) return;

            const trimmedName = displayName.trim();
            const filename = path.basename(selectedModelPath, '.gguf');

            // Generate model ID from filename
            const modelId = filename
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '')
                .substring(0, 50);

            const model: CustomModel = {
                name: modelId,
                provider: 'local',
                filePath: selectedModelPath,
                displayName: trimmedName || filename,
            };

            try {
                await saveCustomModel(model);
                onComplete(model);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to save model');
            }
        }, [selectedModelPath, displayName, onComplete]);

        // Handle input
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    if (!isVisible) return false;

                    // Escape to go back/close
                    if (key.escape) {
                        if (step === 'custom-path' || step === 'display-name') {
                            setStep('select-model');
                            setError(null);
                            return true;
                        }
                        if (step === 'downloading' && downloadError) {
                            setStep('select-model');
                            setDownloadError(null);
                            return true;
                        }
                        onClose();
                        return true;
                    }

                    // Handle based on current step
                    if (step === 'select-model') {
                        const itemCount = models.length + 3; // +3 for special options

                        if (key.upArrow) {
                            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : itemCount - 1));
                            return true;
                        }

                        if (key.downArrow) {
                            setSelectedIndex((prev) => (prev < itemCount - 1 ? prev + 1 : 0));
                            return true;
                        }

                        if (key.return) {
                            // Special options are at the end
                            const showAllIndex = models.length;
                            const customPathIndex = models.length + 1;
                            const backIndex = models.length + 2;

                            if (selectedIndex === backIndex) {
                                onClose();
                                return true;
                            }

                            if (selectedIndex === showAllIndex) {
                                setShowAllModels(!showAllModels);
                                setSelectedIndex(0);
                                setScrollOffset(0);
                                return true;
                            }

                            if (selectedIndex === customPathIndex) {
                                setStep('custom-path');
                                setCustomPath('');
                                setError(null);
                                return true;
                            }

                            // Model selected
                            const model = models[selectedIndex];
                            if (model) {
                                void handleSelectModel(model.id);
                            }
                            return true;
                        }

                        return true; // Consume all input in select mode
                    }

                    if (step === 'custom-path') {
                        if (key.return) {
                            void handleCustomPathSubmit();
                            return true;
                        }

                        if (key.backspace || key.delete) {
                            setCustomPath((prev) => prev.slice(0, -1));
                            setError(null);
                            return true;
                        }

                        if (input && !key.ctrl && !key.meta) {
                            setCustomPath((prev) => prev + input);
                            setError(null);
                            return true;
                        }

                        return true;
                    }

                    if (step === 'display-name') {
                        if (key.return) {
                            void handleDisplayNameSubmit();
                            return true;
                        }

                        if (key.backspace || key.delete) {
                            setDisplayName((prev) => prev.slice(0, -1));
                            return true;
                        }

                        if (input && !key.ctrl && !key.meta) {
                            setDisplayName((prev) => prev + input);
                            return true;
                        }

                        return true;
                    }

                    if (step === 'downloading') {
                        // Only allow escape if there's an error
                        return true;
                    }

                    return false;
                },
            }),
            [
                isVisible,
                step,
                models,
                selectedIndex,
                showAllModels,
                customPath,
                displayName,
                downloadError,
                handleSelectModel,
                handleCustomPathSubmit,
                handleDisplayNameSubmit,
                onClose,
            ]
        );

        if (!isVisible) return null;

        // Node-llama-cpp not installed warning
        if (!nodeLlamaInstalled) {
            return (
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor="yellow"
                    paddingX={1}
                    marginTop={1}
                >
                    <Box marginBottom={1}>
                        <Text bold color="yellow">
                            node-llama-cpp Required
                        </Text>
                    </Box>
                    <Text>Local model execution requires node-llama-cpp.</Text>
                    <Text color="gray">Run `dexto setup` and select Local to install it.</Text>
                    <Box marginTop={1}>
                        <Text color="gray">Press Esc to go back</Text>
                    </Box>
                </Box>
            );
        }

        // Loading state
        if (isLoading) {
            return (
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor="green"
                    paddingX={1}
                    marginTop={1}
                >
                    <Text color="gray">Loading models...</Text>
                </Box>
            );
        }

        // Download progress
        if (step === 'downloading') {
            return (
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor="green"
                    paddingX={1}
                    marginTop={1}
                >
                    <Box marginBottom={1}>
                        <Text bold color="green">
                            Downloading Model
                        </Text>
                    </Box>

                    {downloadError ? (
                        <>
                            <Text color="red">Download failed: {downloadError}</Text>
                            <Box marginTop={1}>
                                <Text color="gray">Press Esc to go back</Text>
                            </Box>
                        </>
                    ) : downloadProgress ? (
                        <>
                            <Text>
                                {selectedModelId}: {downloadProgress.percentage.toFixed(1)}%
                            </Text>
                            <Text color="gray">
                                {formatSize(downloadProgress.bytesDownloaded)} /{' '}
                                {formatSize(downloadProgress.totalBytes)}
                                {downloadProgress.speed
                                    ? ` • ${formatSize(downloadProgress.speed)}/s`
                                    : ''}
                                {downloadProgress.eta
                                    ? ` • ETA: ${Math.round(downloadProgress.eta)}s`
                                    : ''}
                            </Text>
                            {/* Simple progress bar */}
                            <Box marginTop={1}>
                                <Text color="green">
                                    {'█'.repeat(Math.floor(downloadProgress.percentage / 5))}
                                </Text>
                                <Text color="gray">
                                    {'░'.repeat(20 - Math.floor(downloadProgress.percentage / 5))}
                                </Text>
                            </Box>
                        </>
                    ) : (
                        <Text color="gray">Starting download...</Text>
                    )}
                </Box>
            );
        }

        // Custom path input
        if (step === 'custom-path') {
            return (
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor="green"
                    paddingX={1}
                    marginTop={1}
                >
                    <Box marginBottom={1}>
                        <Text bold color="green">
                            Custom GGUF File
                        </Text>
                    </Box>

                    <Text>Enter path to GGUF file:</Text>
                    <Box marginTop={1}>
                        <Text color="gray">&gt; </Text>
                        <Text>{customPath}</Text>
                        <Text color="cyan">▌</Text>
                    </Box>
                    <Text color="gray">e.g., /path/to/model.gguf or ~/models/llama.gguf</Text>

                    {error && (
                        <Box marginTop={1}>
                            <Text color="red">{error}</Text>
                        </Box>
                    )}

                    <Box marginTop={1}>
                        <Text color="gray">Enter to continue • Esc to go back</Text>
                    </Box>
                </Box>
            );
        }

        // Display name input
        if (step === 'display-name') {
            return (
                <Box
                    flexDirection="column"
                    borderStyle="round"
                    borderColor="green"
                    paddingX={1}
                    marginTop={1}
                >
                    <Box marginBottom={1}>
                        <Text bold color="green">
                            Display Name
                        </Text>
                    </Box>

                    <Text>Display name (optional):</Text>
                    <Box marginTop={1}>
                        <Text color="gray">&gt; </Text>
                        <Text>{displayName}</Text>
                        <Text color="cyan">▌</Text>
                    </Box>

                    {error && (
                        <Box marginTop={1}>
                            <Text color="red">{error}</Text>
                        </Box>
                    )}

                    <Box marginTop={1}>
                        <Text color="gray">Enter to save • Esc to go back</Text>
                    </Box>
                </Box>
            );
        }

        // Model selection
        const allItems = [
            ...models,
            { type: 'show-all' as const },
            { type: 'custom-path' as const },
            { type: 'back' as const },
        ];

        const visibleStart = scrollOffset;
        const visibleEnd = Math.min(scrollOffset + MAX_VISIBLE_ITEMS, allItems.length);
        const visibleItems = allItems.slice(visibleStart, visibleEnd);

        return (
            <Box
                flexDirection="column"
                borderStyle="round"
                borderColor="green"
                paddingX={1}
                marginTop={1}
            >
                {/* Header */}
                <Box marginBottom={1}>
                    <Text bold color="green">
                        Local Model
                    </Text>
                    <Text color="gray">
                        {' '}
                        ({selectedIndex + 1}/{allItems.length})
                    </Text>
                </Box>

                {/* Setup info */}
                <SetupInfoBanner
                    title="Local Models"
                    description="Select a model to download, or use a custom GGUF file. Models run completely on your machine - free, private, and offline."
                    docsUrl="https://docs.dexto.ai/guides/supported-llm-providers#local-models"
                />

                {/* Model list */}
                {visibleItems.map((item, visibleIndex) => {
                    const actualIndex = scrollOffset + visibleIndex;
                    const isSelected = actualIndex === selectedIndex;

                    if ('type' in item) {
                        if (item.type === 'show-all') {
                            return (
                                <Box key="show-all" paddingY={0}>
                                    <Text color={isSelected ? 'cyan' : 'blue'} bold={isSelected}>
                                        {isSelected ? '› ' : '  '}
                                        {showAllModels
                                            ? '↩ Show recommended'
                                            : '... Show all models'}
                                    </Text>
                                    <Text color="gray">
                                        {' '}
                                        ({getAllLocalModels().length} available)
                                    </Text>
                                </Box>
                            );
                        }
                        if (item.type === 'custom-path') {
                            return (
                                <Box key="custom-path" paddingY={0}>
                                    <Text color={isSelected ? 'cyan' : 'blue'} bold={isSelected}>
                                        {isSelected ? '› ' : '  '}
                                        ... Use custom GGUF file
                                    </Text>
                                </Box>
                            );
                        }
                        if (item.type === 'back') {
                            return (
                                <Box key="back" paddingY={0}>
                                    <Text color={isSelected ? 'cyan' : 'gray'} bold={isSelected}>
                                        {isSelected ? '› ' : '  '}← Back
                                    </Text>
                                </Box>
                            );
                        }
                    }

                    // Model option
                    const model = item as ModelOption;
                    const statusIcon = model.isInstalled ? '✓' : '○';
                    const statusColor = model.isInstalled ? 'green' : 'gray';
                    const vramHint = model.minVRAM ? `${model.minVRAM}GB+ VRAM` : 'CPU OK';

                    return (
                        <Box key={model.id} paddingY={0}>
                            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                                {isSelected ? '› ' : '  '}
                            </Text>
                            <Text color={statusColor}>{statusIcon} </Text>
                            <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                                {model.name}
                            </Text>
                            <Text color="gray">
                                {' '}
                                {formatSize(model.sizeBytes)} | {vramHint}
                                {model.isInstalled ? ' (installed)' : ''}
                            </Text>
                        </Box>
                    );
                })}

                {/* Scroll indicator */}
                {allItems.length > MAX_VISIBLE_ITEMS && (
                    <Box marginTop={1}>
                        <Text color="gray">
                            {scrollOffset > 0 ? '↑ more above ' : ''}
                            {visibleEnd < allItems.length ? '↓ more below' : ''}
                        </Text>
                    </Box>
                )}

                {/* Help text */}
                <Box marginTop={1}>
                    <Text color="gray">↑↓ navigate • Enter select • Esc back</Text>
                </Box>

                {error && (
                    <Box marginTop={1}>
                        <Text color="red">{error}</Text>
                    </Box>
                )}
            </Box>
        );
    }
);

export default LocalModelWizard;
