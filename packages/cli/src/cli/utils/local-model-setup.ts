// packages/cli/src/cli/utils/local-model-setup.ts

/**
 * Interactive setup flow for local AI models.
 *
 * This module provides the setup experience when a user selects
 * 'local' or 'ollama' as their provider during `dexto setup`.
 */

import chalk from 'chalk';
import * as p from '@clack/prompts';
import * as fs from 'fs';
import * as path from 'path';
import {
    getRecommendedLocalModels,
    getAllLocalModels,
    getLocalModelById,
    detectGPU,
    formatGPUInfo,
    downloadModel,
    checkOllamaStatus,
    listOllamaModels,
    isOllamaModelAvailable,
    pullOllamaModel,
    isNodeLlamaCppInstalled,
    type ModelDownloadProgress,
} from '@dexto/core';
import { spawn } from 'child_process';
import {
    getAllInstalledModels,
    setActiveModel,
    addInstalledModel,
    getModelsDirectory,
    modelFileExists,
    getModelFileSize,
    formatSize,
    saveCustomModel,
    getDextoGlobalPath,
    type InstalledModel,
} from '@dexto/agent-management';

/**
 * Result of local model setup
 */
export interface LocalModelSetupResult {
    /** Whether setup completed successfully */
    success: boolean;

    /** Selected model ID */
    modelId?: string;

    /** Whether user cancelled */
    cancelled?: boolean;

    /** Whether user wants to go back to provider selection */
    back?: boolean;

    /** Whether user skipped model selection */
    skipped?: boolean;
}

/**
 * Type guard: Check if local model setup result has a selected model.
 * Use this before proceeding with model configuration.
 *
 * Returns false for: cancelled, back, skipped, or missing modelId
 * Returns true only when: success=true AND modelId is present
 */
export function hasSelectedModel(
    result: LocalModelSetupResult
): result is LocalModelSetupResult & { modelId: string } {
    return (
        result.success && !result.cancelled && !result.back && !result.skipped && !!result.modelId
    );
}

/**
 * Install node-llama-cpp to the global deps directory (~/.dexto/deps).
 * This compiles native bindings for the user's system.
 * Installing globally ensures it's available for CLI, WebUI, and all projects.
 */
async function installNodeLlamaCpp(): Promise<boolean> {
    const depsDir = getDextoGlobalPath('deps');

    // Ensure deps directory exists
    if (!fs.existsSync(depsDir)) {
        fs.mkdirSync(depsDir, { recursive: true });
    }

    // Initialize package.json if it doesn't exist (required for package installs)
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
        // Install to global deps directory (may compile native bindings)
        const child = spawn('bun', ['add', '--trust', 'node-llama-cpp', '--save-text-lockfile'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            cwd: depsDir,
            shell: true,
        });

        let stderr = '';
        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(true);
            } else {
                console.error(chalk.gray(stderr));
                resolve(false);
            }
        });

        child.on('error', () => {
            resolve(false);
        });
    });
}

/**
 * Check and install node-llama-cpp if needed.
 * Returns true if ready to use, false if installation failed/cancelled.
 */
async function ensureNodeLlamaCpp(): Promise<boolean> {
    const isInstalled = await isNodeLlamaCppInstalled();
    if (isInstalled) {
        return true;
    }

    p.note(
        'Local model execution requires node-llama-cpp.\n' +
            'This will compile native bindings for your system.\n\n' +
            chalk.gray('Installation may take 1-2 minutes.'),
        'Dependency Required'
    );

    const shouldInstall = await p.confirm({
        message: 'Install node-llama-cpp now?',
        initialValue: true,
    });

    if (p.isCancel(shouldInstall) || !shouldInstall) {
        return false;
    }

    const spinner = p.spinner();
    spinner.start('Installing node-llama-cpp (compiling native bindings)...');

    const success = await installNodeLlamaCpp();

    if (success) {
        spinner.stop(chalk.green('✓ node-llama-cpp installed successfully'));
        return true;
    } else {
        spinner.stop(chalk.red('✗ Installation failed'));
        const depsDir = getDextoGlobalPath('deps');
        p.log.error(
            'Failed to install node-llama-cpp. You can try manually:\n' +
                chalk.gray(`  cd ${depsDir} && bun add --trust node-llama-cpp`)
        );
        return false;
    }
}

/**
 * Interactive local model setup for 'local' provider.
 *
 * Shows available models, offers to download, and sets up the active model.
 * Uses node-llama-cpp for native GGUF model execution.
 */
export async function setupLocalModels(): Promise<LocalModelSetupResult> {
    console.log(chalk.cyan('\n🤖 Local Model Setup\n'));

    // Ensure node-llama-cpp is installed first
    const dependencyReady = await ensureNodeLlamaCpp();
    if (!dependencyReady) {
        p.log.warn('Setup cancelled - node-llama-cpp is required for local models.');
        return { success: false, cancelled: true };
    }

    // Get installed models first - if already installed, we can skip other checks
    const installed = await getAllInstalledModels();
    const installedIds = new Set(installed.map((m) => m.id));

    // Check if any models are already installed - offer quick path
    if (installed.length > 0) {
        const useExisting = await p.confirm({
            message: `You have ${installed.length} model(s) installed. Use an existing model?`,
            initialValue: true,
        });

        if (p.isCancel(useExisting)) {
            return { success: false, cancelled: true };
        }

        if (useExisting) {
            // Let user select from installed models - no additional setup needed
            const selected = await selectInstalledModel(installed);
            if (selected.cancelled) {
                return { success: false, cancelled: true };
            }
            if (selected.customGGUF) {
                // User wants to use a custom GGUF file
                return setupCustomGGUF();
            }
            if (selected.modelId) {
                await setActiveModel(selected.modelId);
                p.log.success(`Using ${selected.modelId} as active model`);
                return { success: true, modelId: selected.modelId };
            }
        }
    }

    // Only detect GPU if we're going to show model recommendations
    const gpuInfo = await detectGPU();
    console.log(chalk.gray(`GPU detected: ${formatGPUInfo(gpuInfo)}\n`));

    // Get recommended models
    const recommendedModels = getRecommendedLocalModels();

    // Build options with install status
    const modelOptions = recommendedModels.map((model) => {
        const isInstalled = installedIds.has(model.id);
        const statusIcon = isInstalled ? chalk.green('✓') : chalk.gray('○');
        const vramHint = model.minVRAM ? `${model.minVRAM}GB+ VRAM` : 'CPU OK';

        return {
            value: model.id,
            label: `${statusIcon} ${model.name}`,
            hint: `${formatSize(model.sizeBytes)} | ${vramHint}${isInstalled ? ' (installed)' : ''}`,
        };
    });

    // Add option to see all models
    modelOptions.push({
        value: '_all_models',
        label: `${chalk.blue('...')} Show all available models`,
        hint: `${getAllLocalModels().length} models available`,
    });

    // Add option to use custom GGUF file
    modelOptions.push({
        value: '_custom_gguf',
        label: `${chalk.blue('...')} Use custom GGUF file`,
        hint: 'For GGUF files not in registry',
    });

    // Add option to skip
    modelOptions.push({
        value: '_skip',
        label: `${chalk.rgb(255, 165, 0)('→')} Skip for now`,
        hint: 'Configure later with: dexto setup',
    });

    // Add back option
    modelOptions.push({
        value: '_back',
        label: chalk.gray('← Back'),
        hint: 'Choose a different provider',
    });

    p.note(
        'Local models run completely on your machine - free, private, and offline.\n' +
            'Select a model to download (or use an existing one).',
        'Local AI'
    );

    const selected = await p.select({
        message: 'Choose a model to use',
        options: modelOptions,
    });

    if (p.isCancel(selected)) {
        return { success: false, cancelled: true };
    }

    if (selected === '_skip') {
        p.log.info(chalk.gray('Skipped model selection. Use `dexto setup` to configure later.'));
        return { success: true, skipped: true };
    }

    if (selected === '_back') {
        return { success: false, back: true };
    }

    if (selected === '_all_models') {
        // Show all models
        return await showAllModelsSelection(installedIds);
    }

    if (selected === '_custom_gguf') {
        // Use custom GGUF file
        return setupCustomGGUF();
    }

    const modelId = selected as string;

    // Check if already installed
    if (installedIds.has(modelId)) {
        await setActiveModel(modelId);
        p.log.success(`Using ${modelId} as active model`);
        return { success: true, modelId };
    }

    // Download the model
    const downloadResult = await downloadModelInteractive(modelId);
    if (!downloadResult.success) {
        if (downloadResult.cancelled) {
            return { success: false, cancelled: true };
        }
        return { success: false };
    }

    // Set as active
    await setActiveModel(modelId);
    return { success: true, modelId };
}

/**
 * Check if Ollama model is available, offer to pull if not.
 * Returns true if model is ready to use, false if user declined pull or pull failed.
 */
async function ensureOllamaModelAvailable(modelName: string): Promise<boolean> {
    // Check if model is already available
    const isAvailable = await isOllamaModelAvailable(modelName);
    if (isAvailable) {
        return true;
    }

    // Model not found - offer to pull it
    console.log(chalk.rgb(255, 165, 0)(`\n⚠️  Model '${modelName}' is not available locally.\n`));

    const shouldPull = await p.confirm({
        message: `Pull '${modelName}' from Ollama now?`,
        initialValue: true,
    });

    if (p.isCancel(shouldPull) || !shouldPull) {
        p.log.warn('Skipping model pull. You can pull it later with: ollama pull ' + modelName);
        return false;
    }

    // Pull the model with progress display
    const spinner = p.spinner();
    spinner.start(`Pulling ${modelName} from Ollama...`);

    try {
        await pullOllamaModel(modelName, undefined, (progress) => {
            // Update spinner with progress (show percentage if available)
            if (progress.completed && progress.total) {
                const percent = Math.round((progress.completed / progress.total) * 100);
                const sizeDownloaded = formatSize(progress.completed);
                const sizeTotal = formatSize(progress.total);
                spinner.message(
                    `Pulling ${modelName}... ${percent}% (${sizeDownloaded}/${sizeTotal}) - ${progress.status}`
                );
            } else {
                spinner.message(`Pulling ${modelName}... ${progress.status}`);
            }
        });

        spinner.stop(chalk.green(`✓ Successfully pulled ${modelName}`));
        return true;
    } catch (error) {
        spinner.stop(chalk.red('✗ Failed to pull model'));
        console.error(
            chalk.red(`Error: ${error instanceof Error ? error.message : String(error)}`)
        );
        p.log.warn('You can try pulling manually: ollama pull ' + modelName);
        return false;
    }
}

/**
 * Interactive Ollama model setup for 'ollama' provider.
 */
export async function setupOllamaModels(): Promise<LocalModelSetupResult> {
    console.log(chalk.cyan('\n🦙 Ollama Setup\n'));

    // Check if Ollama is running
    const status = await checkOllamaStatus();

    if (!status.running) {
        p.note(
            chalk.rgb(255, 165, 0)('Ollama server is not running.\n\n') +
                'To use Ollama:\n' +
                '  1. Install Ollama: https://ollama.com/download\n' +
                '  2. Start the server: ollama serve\n' +
                '  3. Pull a model: ollama pull llama3.2',
            'Ollama Required'
        );

        const proceed = await p.confirm({
            message: 'Continue setup anyway? (You can configure Ollama later)',
            initialValue: true,
        });

        if (p.isCancel(proceed)) {
            return { success: false, cancelled: true };
        }
        if (!proceed) {
            return { success: false };
        }

        // Let them specify a model name even without Ollama running
        const modelName = await p.text({
            message: 'Enter the Ollama model name to use',
            placeholder: 'llama3.2',
            initialValue: 'llama3.2',
        });

        if (p.isCancel(modelName)) {
            return { success: false, cancelled: true };
        }

        return { success: true, modelId: modelName.trim() };
    }

    // Ollama is running - show available models
    console.log(chalk.green(`✓ Ollama ${status.version || ''} running at ${status.url}\n`));

    const ollamaModels = await listOllamaModels();

    if (ollamaModels.length === 0) {
        p.note(
            'No models found in Ollama.\n\n' +
                'To pull a model:\n' +
                '  ollama pull llama3.2\n\n' +
                'Popular models:\n' +
                '  • llama3.2 (3B/8B general)\n' +
                '  • qwen2.5-coder (coding)\n' +
                '  • mistral (7B general)',
            'No Models'
        );

        const modelName = await p.text({
            message: 'Enter the model name to pull',
            placeholder: 'llama3.2',
            initialValue: 'llama3.2',
        });

        if (p.isCancel(modelName)) {
            return { success: false, cancelled: true };
        }

        const trimmedName = modelName.trim();
        const isReady = await ensureOllamaModelAvailable(trimmedName);

        if (!isReady) {
            // User declined pull or pull failed
            return { success: false };
        }

        return { success: true, modelId: trimmedName };
    }

    // Show available Ollama models
    const modelOptions = ollamaModels.map((model) => ({
        value: model.name,
        label: model.name,
        hint: formatSize(model.size),
    }));

    // Add option to enter custom name
    modelOptions.push({
        value: '_custom',
        label: `${chalk.blue('...')} Enter custom model name`,
        hint: 'For models not yet pulled',
    });

    // Add back option
    modelOptions.push({
        value: '_back',
        label: chalk.gray('← Back'),
        hint: 'Choose a different provider',
    });

    const selected = await p.select({
        message: 'Select an Ollama model',
        options: modelOptions,
    });

    if (p.isCancel(selected)) {
        return { success: false, cancelled: true };
    }

    if (selected === '_back') {
        return { success: false, back: true };
    }

    if (selected === '_custom') {
        const modelName = await p.text({
            message: 'Enter the Ollama model name',
            placeholder: 'llama3.2:70b',
        });

        if (p.isCancel(modelName)) {
            return { success: false, cancelled: true };
        }

        const trimmedName = modelName.trim();
        const isReady = await ensureOllamaModelAvailable(trimmedName);

        if (!isReady) {
            // User declined pull or pull failed
            return { success: false };
        }

        return { success: true, modelId: trimmedName };
    }

    return { success: true, modelId: selected as string };
}

/**
 * Select from installed models
 */
async function selectInstalledModel(
    installed: InstalledModel[]
): Promise<{ modelId?: string; cancelled?: boolean; customGGUF?: boolean }> {
    const options = installed.map((model) => ({
        value: model.id,
        label: model.id,
        hint: formatSize(model.sizeBytes),
    }));

    options.push({
        value: '_download_new',
        label: `${chalk.blue('+')} Download a new model`,
        hint: 'Browse available models',
    });

    options.push({
        value: '_custom_gguf',
        label: `${chalk.blue('...')} Use custom GGUF file`,
        hint: 'For GGUF files not in registry',
    });

    const selected = await p.select({
        message: 'Select a model',
        options,
    });

    if (p.isCancel(selected)) {
        return { cancelled: true };
    }

    if (selected === '_download_new') {
        return {}; // Continue to download flow
    }

    if (selected === '_custom_gguf') {
        return { customGGUF: true };
    }

    return { modelId: selected as string };
}

/**
 * Show all available models for selection
 */
async function showAllModelsSelection(installedIds: Set<string>): Promise<LocalModelSetupResult> {
    const allModels = getAllLocalModels();

    const modelOptions = allModels.map((model) => {
        const isInstalled = installedIds.has(model.id);
        const statusIcon = isInstalled ? chalk.green('✓') : chalk.gray('○');
        const category = model.categories?.[0] || 'general';
        const vramHint = model.minVRAM ? `${model.minVRAM}GB+` : 'CPU';

        return {
            value: model.id,
            label: `${statusIcon} ${model.name}`,
            hint: `${category} | ${formatSize(model.sizeBytes)} | ${vramHint}${isInstalled ? ' (installed)' : ''}`,
        };
    });

    modelOptions.push({
        value: '_back',
        label: `${chalk.rgb(255, 165, 0)('←')} Back`,
        hint: 'Return to recommended models',
    });

    const selected = await p.select({
        message: 'Select a model',
        options: modelOptions,
    });

    if (p.isCancel(selected)) {
        return { success: false, cancelled: true };
    }

    if (selected === '_back') {
        // Recurse back to main setup
        return setupLocalModels();
    }

    const modelId = selected as string;

    // Check if already installed
    if (installedIds.has(modelId)) {
        await setActiveModel(modelId);
        p.log.success(`Using ${modelId} as active model`);
        return { success: true, modelId };
    }

    // Download the model
    const downloadResult = await downloadModelInteractive(modelId);
    if (!downloadResult.success) {
        if (downloadResult.cancelled) {
            return { success: false, cancelled: true };
        }
        return { success: false };
    }

    await setActiveModel(modelId);
    return { success: true, modelId };
}

/**
 * Download a model with interactive progress
 */
async function downloadModelInteractive(
    modelId: string
): Promise<{ success: boolean; cancelled?: boolean }> {
    const modelInfo = getLocalModelById(modelId);
    if (!modelInfo) {
        p.log.error(`Model '${modelId}' not found in registry`);
        return { success: false };
    }

    // Check if model file already exists on disk (but not registered)
    // First check the expected subdirectory, then fallback to root models dir
    const fileExistsInSubdir = await modelFileExists(modelId, modelInfo.filename);
    const rootFilePath = `${getModelsDirectory()}/${modelInfo.filename}`;
    let actualFilePath: string | null = null;
    let fileSize: number | null = null;

    if (fileExistsInSubdir) {
        actualFilePath = `${getModelsDirectory()}/${modelId}/${modelInfo.filename}`;
        fileSize = await getModelFileSize(modelId, modelInfo.filename);
    } else {
        // Check root models directory (legacy or manual placement)
        try {
            const fs = await import('fs/promises');
            const stats = await fs.stat(rootFilePath);
            if (stats.isFile()) {
                actualFilePath = rootFilePath;
                fileSize = stats.size;
            }
        } catch {
            // File doesn't exist in root either
        }
    }

    if (actualFilePath) {
        p.log.info(chalk.green(`✓ Model file already exists on disk`));

        // Register the existing model
        const installedModel: InstalledModel = {
            id: modelId,
            filePath: actualFilePath,
            sizeBytes: fileSize ?? modelInfo.sizeBytes,
            downloadedAt: new Date().toISOString(),
            source: 'huggingface',
            filename: modelInfo.filename,
        };

        await addInstalledModel(installedModel);
        p.log.success(`Model '${modelId}' registered successfully`);
        return { success: true };
    }

    // Show model info and confirm
    p.note(
        `${modelInfo.name}\n` +
            `${modelInfo.description}\n\n` +
            `Size: ${formatSize(modelInfo.sizeBytes)}\n` +
            `Context: ${modelInfo.contextLength.toLocaleString()} tokens\n` +
            `Quantization: ${modelInfo.quantization}`,
        'Model Details'
    );

    const confirmed = await p.confirm({
        message: `Download ${modelInfo.name} (${formatSize(modelInfo.sizeBytes)})?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
        return { success: false, cancelled: true };
    }

    // Start download with spinner
    const spinner = p.spinner();
    spinner.start('Starting download...');

    try {
        const result = await downloadModel(modelId, {
            targetDir: getModelsDirectory(),
            events: {
                onProgress: (progress: ModelDownloadProgress) => {
                    const pct = progress.percentage.toFixed(1);
                    const downloaded = formatSize(progress.bytesDownloaded);
                    const total = formatSize(progress.totalBytes);
                    const speedStr = progress.speed ? `${formatSize(progress.speed)}/s` : '';
                    const etaStr = progress.eta ? `ETA: ${Math.round(progress.eta)}s` : '';

                    spinner.message(`${pct}% (${downloaded}/${total}) ${speedStr} ${etaStr}`);
                },
                onComplete: () => {
                    spinner.stop(chalk.green(`✓ Downloaded ${modelInfo.name}`));
                },
                onError: (_modelId: string, error: Error) => {
                    spinner.stop(chalk.red(`✗ Download failed: ${error.message}`));
                },
            },
        });

        // Register the installed model
        const installedModel: InstalledModel = {
            id: modelId,
            filePath: result.filePath,
            sizeBytes: result.sizeBytes,
            downloadedAt: new Date().toISOString(),
            source: 'huggingface',
            filename: modelInfo.filename,
        };

        if (result.sha256) {
            installedModel.sha256 = result.sha256;
        }

        await addInstalledModel(installedModel);

        p.log.success(`Model '${modelId}' installed successfully`);
        return { success: true };
    } catch (error) {
        spinner.stop(chalk.red('Download failed'));
        p.log.error(
            `Failed to download: ${error instanceof Error ? error.message : String(error)}`
        );
        return { success: false };
    }
}

/**
 * Setup a custom GGUF file.
 * Prompts user for file path, validates it, and saves as a custom model.
 * Mirrors the Ollama "Enter custom model name" pattern.
 */
async function setupCustomGGUF(): Promise<LocalModelSetupResult> {
    // Prompt for file path
    const filePath = await p.text({
        message: 'Enter path to GGUF file',
        placeholder: '/path/to/model.gguf',
        validate: (value) => {
            if (!value.trim()) {
                return 'File path is required';
            }
            if (!value.endsWith('.gguf')) {
                return 'File must have .gguf extension';
            }
            if (!path.isAbsolute(value)) {
                return 'Please enter an absolute path';
            }
            return undefined;
        },
    });

    if (p.isCancel(filePath)) {
        return { success: false, cancelled: true };
    }

    const trimmedPath = filePath.trim();

    // Validate file exists
    try {
        const stats = fs.statSync(trimmedPath);
        if (!stats.isFile()) {
            p.log.error('Path is not a file');
            return { success: false };
        }

        const sizeBytes = stats.size;
        const filename = path.basename(trimmedPath, '.gguf');

        console.log(
            chalk.green(`\n✓ Found: ${path.basename(trimmedPath)} (${formatSize(sizeBytes)})\n`)
        );

        // Prompt for display name (optional)
        const displayName = await p.text({
            message: 'Display name (optional)',
            placeholder: filename,
            initialValue: filename,
        });

        if (p.isCancel(displayName)) {
            return { success: false, cancelled: true };
        }

        // Note: Context length is auto-detected by node-llama-cpp from the GGUF file

        // Generate a model ID from the filename
        // Convert to lowercase, replace spaces with dashes, remove special chars
        let modelId = filename
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .substring(0, 50); // Limit length

        // Fallback if modelId is empty after sanitization
        if (!modelId) {
            modelId = `custom-model-${Date.now()}`;
        }

        // Save as custom model
        await saveCustomModel({
            name: modelId,
            provider: 'local',
            filePath: trimmedPath,
            displayName: displayName?.trim() || filename,
        });

        p.log.success(`Registered as '${modelId}'`);

        return { success: true, modelId };
    } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === 'ENOENT') {
            p.log.error('File not found');
        } else if (nodeError.code === 'EACCES') {
            p.log.error('Permission denied - file is not readable');
        } else {
            p.log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
        return { success: false };
    }
}

/**
 * Get the model name for preferences from a validated setup result.
 *
 * IMPORTANT: Only call this after validating with hasSelectedModel().
 * Throws if modelId is missing (indicates a bug in the calling code).
 */
export function getModelFromResult(result: LocalModelSetupResult & { modelId: string }): string {
    return result.modelId;
}
