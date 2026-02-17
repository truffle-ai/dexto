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
import { spawn } from 'child_process';
import type { Key } from '../../../hooks/useInputOrchestrator.js';
import {
    saveCustomModel,
    getAllInstalledModels,
    addInstalledModel,
    removeInstalledModel,
    getModelsDirectory,
    formatSize,
    getDextoGlobalPath,
    type InstalledModel,
    type CustomModel,
} from '@dexto/agent-management';
import { promises as fsPromises } from 'fs';
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

type WizardStep =
    | 'install-node-llama'
    | 'select-model'
    | 'custom-path'
    | 'display-name'
    | 'downloading'
    | 'installed-options';

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
        const [nodeLlamaChecked, setNodeLlamaChecked] = useState(false); // Track if we've checked installation
        const [isInstallingNodeLlama, setIsInstallingNodeLlama] = useState(false);
        const [installConfirmIndex, setInstallConfirmIndex] = useState(0); // 0 = Yes, 1 = No
        const [installSpinnerFrame, setInstallSpinnerFrame] = useState(0);
        const [refreshTrigger, setRefreshTrigger] = useState(0); // Increment to trigger data reload

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

        // Installed model options state
        const [installedOptionIndex, setInstalledOptionIndex] = useState(0);
        const [selectedInstalledModel, setSelectedInstalledModel] = useState<{
            id: string;
            filePath: string;
            displayName: string;
        } | null>(null);
        const [isDeleting, setIsDeleting] = useState(false);

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
            setInstalledOptionIndex(0);
            setSelectedInstalledModel(null);
            setIsDeleting(false);
            setError(null);
            setIsInstallingNodeLlama(false);
            setInstallConfirmIndex(0);
            setInstallSpinnerFrame(0);
            setNodeLlamaChecked(false);
        }, [isVisible]);

        // Spinner animation for installation
        useEffect(() => {
            if (!isInstallingNodeLlama) return;

            const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
            const interval = setInterval(() => {
                setInstallSpinnerFrame((prev) => (prev + 1) % spinnerFrames.length);
            }, 80);

            return () => clearInterval(interval);
        }, [isInstallingNodeLlama]);

        // Load models when visible or when showAllModels changes
        useEffect(() => {
            if (!isVisible) return;

            let cancelled = false;

            const loadData = async () => {
                setIsLoading(true);

                try {
                    // Check if node-llama-cpp is installed
                    // Skip if we've already checked AND it's installed (prevents re-check after install)
                    if (!nodeLlamaChecked || !nodeLlamaInstalled) {
                        const installed = await isNodeLlamaCppInstalled();
                        if (!cancelled) {
                            setNodeLlamaInstalled(installed);
                            setNodeLlamaChecked(true);
                            if (!installed) {
                                setStep('install-node-llama');
                                setIsLoading(false);
                                return;
                            }
                        }
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
        }, [isVisible, showAllModels, refreshTrigger, nodeLlamaInstalled, nodeLlamaChecked]);

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
                // Check if already installed - show options (Use / Delete)
                if (installedIds.has(modelId)) {
                    const modelInfo = getLocalModelById(modelId);
                    const installedModels = await getAllInstalledModels();
                    const installedModel = installedModels.find((m) => m.id === modelId);

                    setSelectedInstalledModel({
                        id: modelId,
                        filePath: installedModel?.filePath || '',
                        displayName: modelInfo?.name || modelId,
                    });
                    setInstalledOptionIndex(0);
                    setStep('installed-options');
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

                    // Registry models are tracked in state.json, not custom-models.json
                    // Just complete - the model will appear in the selector via getAllInstalledModels()
                    onComplete({
                        name: modelId,
                        provider: 'local',
                        displayName: modelInfo?.name || modelId,
                    });
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

        // Handle installed model option selection
        const handleInstalledOption = useCallback(async () => {
            if (!selectedInstalledModel) return;

            if (installedOptionIndex === 0) {
                // "Use this model" option
                onComplete({
                    name: selectedInstalledModel.id,
                    provider: 'local',
                    displayName: selectedInstalledModel.displayName,
                });
            } else {
                // "Delete model" option
                setIsDeleting(true);
                setError(null);

                try {
                    // Delete the GGUF file from disk
                    if (selectedInstalledModel.filePath) {
                        try {
                            await fsPromises.unlink(selectedInstalledModel.filePath);
                        } catch (err) {
                            // File might already be deleted - continue
                            const nodeErr = err as NodeJS.ErrnoException;
                            if (nodeErr.code !== 'ENOENT') {
                                throw err;
                            }
                        }
                    }

                    // Remove from state.json
                    await removeInstalledModel(selectedInstalledModel.id);

                    // Refresh the model list
                    setInstalledIds((prev) => {
                        const next = new Set(prev);
                        next.delete(selectedInstalledModel.id);
                        return next;
                    });

                    // Go back to model selection
                    setStep('select-model');
                    setSelectedInstalledModel(null);
                } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to delete model');
                } finally {
                    setIsDeleting(false);
                }
            }
        }, [selectedInstalledModel, installedOptionIndex, onComplete]);

        // Install node-llama-cpp to global deps directory
        const installNodeLlamaCpp = useCallback(async (): Promise<boolean> => {
            const depsDir = getDextoGlobalPath('deps');

            // Ensure deps directory exists
            if (!fs.existsSync(depsDir)) {
                fs.mkdirSync(depsDir, { recursive: true });
            }

            // Initialize package.json if it doesn't exist
            const packageJsonPath = path.join(depsDir, 'package.json');
            if (!fs.existsSync(packageJsonPath)) {
                fs.writeFileSync(
                    packageJsonPath,
                    JSON.stringify(
                        {
                            name: 'dexto-deps',
                            version: '1.0.0',
                            private: true,
                            description: 'Native dependencies for Dexto',
                        },
                        null,
                        2
                    )
                );
            }

            return new Promise((resolve) => {
                const child = spawn(
                    'bun',
                    ['add', '--trust', 'node-llama-cpp', '--save-text-lockfile'],
                    {
                        stdio: ['ignore', 'ignore', 'pipe'], // stdin ignored, stdout ignored (not needed), stderr piped for errors
                        cwd: depsDir,
                    }
                );

                let stderr = '';
                child.stderr?.on('data', (data) => {
                    stderr += data.toString();
                });

                child.on('close', (code) => {
                    if (code === 0) {
                        resolve(true);
                    } else {
                        setError(`Installation failed: ${stderr.slice(0, 200)}`);
                        resolve(false);
                    }
                });

                child.on('error', (err) => {
                    setError(`Installation failed: ${err.message}`);
                    resolve(false);
                });
            });
        }, []);

        // Handle install confirmation
        const handleInstallConfirm = useCallback(async () => {
            if (installConfirmIndex === 1) {
                // User chose "No"
                onClose();
                return;
            }

            // User chose "Yes" - start installation
            setIsInstallingNodeLlama(true);
            setError(null);

            const success = await installNodeLlamaCpp();

            setIsInstallingNodeLlama(false);

            if (success) {
                // Trust bun's exit code - set states and go directly to model selection
                setNodeLlamaInstalled(true);
                setNodeLlamaChecked(true);
                setStep('select-model');
                setIsLoading(true);
                // Trigger reload of models
                setRefreshTrigger((prev) => prev + 1);
            } else {
                // Error should already be set by installNodeLlamaCpp, but ensure we show something
                setError(
                    (prev) =>
                        prev || 'Installation failed. Check your internet connection and try again.'
                );
            }
        }, [installConfirmIndex, installNodeLlamaCpp, onClose]);

        // Handle input
        useImperativeHandle(
            ref,
            () => ({
                handleInput: (input: string, key: Key): boolean => {
                    if (!isVisible) return false;

                    // Escape to go back/close
                    if (key.escape) {
                        if (
                            step === 'custom-path' ||
                            step === 'display-name' ||
                            step === 'installed-options'
                        ) {
                            setStep('select-model');
                            setError(null);
                            setSelectedInstalledModel(null);
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
                    if (step === 'install-node-llama') {
                        if (isInstallingNodeLlama) return true; // Don't allow input while installing

                        if (key.upArrow || key.downArrow) {
                            setInstallConfirmIndex((prev) => (prev === 0 ? 1 : 0));
                            return true;
                        }

                        if (key.return) {
                            void handleInstallConfirm();
                            return true;
                        }

                        return true;
                    }

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

                    if (step === 'installed-options') {
                        if (isDeleting) return true; // Don't allow input while deleting

                        if (key.upArrow || key.downArrow) {
                            setInstalledOptionIndex((prev) => (prev === 0 ? 1 : 0));
                            return true;
                        }

                        if (key.return) {
                            void handleInstalledOption();
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
                isDeleting,
                installedOptionIndex,
                handleSelectModel,
                handleCustomPathSubmit,
                handleDisplayNameSubmit,
                handleInstalledOption,
                handleInstallConfirm,
                isInstallingNodeLlama,
                installConfirmIndex,
                onClose,
            ]
        );

        if (!isVisible) return null;

        // Node-llama-cpp install prompt
        if (step === 'install-node-llama') {
            const options = [
                { label: 'Yes', description: 'Install now (may take 1-2 minutes)' },
                { label: 'No', description: 'Go back' },
            ];

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
                            Dependency Required
                        </Text>
                    </Box>

                    <Text>Local model execution requires node-llama-cpp.</Text>
                    <Text color="gray">This will compile native bindings for your system.</Text>

                    {isInstallingNodeLlama ? (
                        <Box marginTop={1} flexDirection="column">
                            <Box>
                                <Text color="cyan">
                                    {
                                        ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][
                                            installSpinnerFrame
                                        ]
                                    }{' '}
                                    Installing node-llama-cpp (compiling native bindings)...
                                </Text>
                            </Box>
                            <Text color="gray">This may take 1-2 minutes.</Text>
                        </Box>
                    ) : (
                        <>
                            <Box marginTop={1} marginBottom={1}>
                                <Text>Install node-llama-cpp now?</Text>
                            </Box>

                            {options.map((option, idx) => (
                                <Box key={option.label}>
                                    <Text color={idx === installConfirmIndex ? 'cyan' : 'white'}>
                                        {idx === installConfirmIndex ? '❯ ' : '  '}
                                        {option.label}
                                    </Text>
                                    {idx === installConfirmIndex && (
                                        <Text color="gray"> - {option.description}</Text>
                                    )}
                                </Box>
                            ))}
                        </>
                    )}

                    {error && (
                        <Box marginTop={1}>
                            <Text color="red">{error}</Text>
                        </Box>
                    )}

                    <Box marginTop={1}>
                        <Text color="gray">
                            {isInstallingNodeLlama
                                ? 'Please wait...'
                                : '↑↓ navigate • Enter select • Esc cancel'}
                        </Text>
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
                                    {'█'.repeat(
                                        Math.min(20, Math.floor(downloadProgress.percentage / 5))
                                    )}
                                </Text>
                                <Text color="gray">
                                    {'░'.repeat(
                                        Math.max(
                                            0,
                                            20 - Math.floor(downloadProgress.percentage / 5)
                                        )
                                    )}
                                </Text>
                            </Box>
                        </>
                    ) : (
                        <Text color="gray">Starting download...</Text>
                    )}
                </Box>
            );
        }

        // Installed model options (Use / Delete)
        if (step === 'installed-options' && selectedInstalledModel) {
            const options = [
                { label: 'Use this model', description: 'Select this model for chat' },
                { label: 'Delete model', description: 'Remove from disk and uninstall' },
            ];

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
                            {selectedInstalledModel.displayName}
                        </Text>
                        <Text color="gray"> (installed)</Text>
                    </Box>

                    {isDeleting ? (
                        <Text color="yellow">Deleting model...</Text>
                    ) : (
                        <>
                            {options.map((option, idx) => (
                                <Box key={option.label}>
                                    <Text color={idx === installedOptionIndex ? 'cyan' : 'white'}>
                                        {idx === installedOptionIndex ? '❯ ' : '  '}
                                        {option.label}
                                    </Text>
                                    {idx === installedOptionIndex && (
                                        <Text color="gray"> - {option.description}</Text>
                                    )}
                                </Box>
                            ))}
                        </>
                    )}

                    {error && (
                        <Box marginTop={1}>
                            <Text color="red">{error}</Text>
                        </Box>
                    )}

                    <Box marginTop={1}>
                        <Text color="gray">
                            {isDeleting ? 'Please wait...' : 'Enter to select • Esc to go back'}
                        </Text>
                    </Box>
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
                    docsUrl="https://docs.dexto.ai/docs/guides/supported-llm-providers#local-models"
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
