// packages/cli/src/cli/commands/models.ts

/**
 * CLI command for managing local AI models.
 *
 * Commands:
 *   dexto models                    - List installed models
 *   dexto models list               - List available models from registry
 *   dexto models download <id>      - Download a model
 *   dexto models remove <id>        - Remove an installed model
 *   dexto models info <id>          - Show model details
 *   dexto models use <id>           - Set as active model
 */

import chalk from 'chalk';
import * as p from '@clack/prompts';
import {
    getAllLocalModels,
    getLocalModelById,
    getRecommendedLocalModels,
    downloadModel,
    detectGPU,
    formatGPUInfo,
    checkOllamaStatus,
    listOllamaModels,
    type LocalModelInfo,
    type ModelDownloadProgress,
} from '@dexto/core';
import {
    getAllInstalledModels,
    getInstalledModel,
    removeInstalledModel,
    setActiveModel,
    getActiveModelId,
    addInstalledModel,
    syncStateWithFilesystem,
    getTotalInstalledSize,
    getModelsDirectory,
    type InstalledModel,
} from '@dexto/agent-management';
import { promises as fs } from 'fs';

/**
 * Format file size in human-readable format.
 */
function formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let size = bytes;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Format download speed.
 */
function formatSpeed(bytesPerSecond: number): string {
    return `${formatSize(bytesPerSecond)}/s`;
}

/**
 * Format ETA in human-readable format.
 */
function formatETA(seconds: number): string {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    }
    if (seconds < 3600) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${mins}m ${secs}s`;
    }
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
}

/**
 * Handle the main models command (list installed).
 */
export async function handleModelsCommand(): Promise<void> {
    console.log(chalk.cyan('\n📦 Local AI Models\n'));

    // Sync state with filesystem first
    const { removed } = await syncStateWithFilesystem();
    if (removed.length > 0) {
        console.log(chalk.yellow(`Cleaned up ${removed.length} missing model(s) from state\n`));
    }

    const installed = await getAllInstalledModels();
    const activeModelId = await getActiveModelId();

    if (installed.length === 0) {
        console.log(chalk.gray('No models installed yet.'));
        console.log(chalk.gray('\nTo get started:'));
        console.log(chalk.gray('  dexto models list              List available models'));
        console.log(chalk.gray('  dexto models download <id>     Download a model\n'));
        return;
    }

    // Show GPU info
    const gpuInfo = await detectGPU();
    console.log(chalk.dim(`GPU: ${formatGPUInfo(gpuInfo)}\n`));

    console.log(chalk.green('Installed Models:'));

    for (const model of installed) {
        const isActive = model.id === activeModelId;
        const activeIndicator = isActive ? chalk.green(' ★ active') : '';

        // Get registry info for more details
        const registryInfo = getLocalModelById(model.id);
        const contextInfo = registryInfo?.contextLength
            ? chalk.dim(` (${registryInfo.contextLength.toLocaleString()} ctx)`)
            : '';

        console.log(
            `  ${isActive ? chalk.green('●') : chalk.gray('○')} ${chalk.bold(model.id)}${activeIndicator}`
        );
        console.log(chalk.gray(`    Size: ${formatSize(model.sizeBytes)}${contextInfo}`));
        console.log(chalk.gray(`    Source: ${model.source}`));
        if (model.lastUsedAt) {
            const lastUsed = new Date(model.lastUsedAt);
            console.log(chalk.gray(`    Last used: ${lastUsed.toLocaleDateString()}`));
        }
        console.log();
    }

    const totalSize = await getTotalInstalledSize();
    console.log(chalk.dim(`Total: ${installed.length} model(s), ${formatSize(totalSize)}`));
    console.log(chalk.dim(`Location: ${getModelsDirectory()}\n`));
}

/**
 * Handle models list command (show available models from registry).
 */
export async function handleModelsListCommand(options: {
    recommended?: boolean;
    ollama?: boolean;
}): Promise<void> {
    console.log(chalk.cyan('\n📋 Available Models\n'));

    // Show GPU info for context
    const gpuInfo = await detectGPU();
    console.log(chalk.dim(`GPU: ${formatGPUInfo(gpuInfo)}\n`));

    // Get installed models for status indicator
    const installed = await getAllInstalledModels();
    const installedIds = new Set(installed.map((m) => m.id));

    if (options.ollama) {
        // Show Ollama models
        const status = await checkOllamaStatus();

        if (!status.running) {
            console.log(chalk.yellow('⚠️  Ollama is not running'));
            console.log(chalk.gray('   Start Ollama: ollama serve'));
            console.log(chalk.gray('   Download: https://ollama.com\n'));
            return;
        }

        console.log(chalk.green(`✅ Ollama ${status.version || ''} running at ${status.url}\n`));

        const ollamaModels = await listOllamaModels();

        if (ollamaModels.length === 0) {
            console.log(chalk.gray('No models pulled in Ollama.'));
            console.log(chalk.gray('\nTo pull a model:'));
            console.log(chalk.gray('  ollama pull llama3.2\n'));
            return;
        }

        console.log(chalk.blue('Ollama Models:'));
        for (const model of ollamaModels) {
            const sizeInfo = chalk.dim(`(${formatSize(model.size)})`);
            const quantInfo = model.details?.quantizationLevel
                ? chalk.dim(` [${model.details.quantizationLevel}]`)
                : '';
            console.log(`  • ${chalk.bold(model.name)} ${sizeInfo}${quantInfo}`);
        }
        console.log();
        return;
    }

    // Show registry models
    const models = options.recommended ? getRecommendedLocalModels() : getAllLocalModels();

    if (options.recommended) {
        console.log(chalk.green('Recommended Models:'));
    } else {
        console.log(chalk.blue('All Available Models:'));
    }

    // Group by category (use first category from array)
    const byCategory = new Map<string, LocalModelInfo[]>();
    for (const model of models) {
        const category = model.categories?.[0] || 'general';
        if (!byCategory.has(category)) {
            byCategory.set(category, []);
        }
        byCategory.get(category)!.push(model);
    }

    for (const [category, categoryModels] of byCategory) {
        console.log(chalk.yellow(`\n  ${category.charAt(0).toUpperCase() + category.slice(1)}:`));

        for (const model of categoryModels) {
            const isInstalled = installedIds.has(model.id);
            const statusIcon = isInstalled ? chalk.green('✓') : chalk.gray('○');
            const recommendedTag = model.recommended ? chalk.green(' ★') : '';

            console.log(`    ${statusIcon} ${chalk.bold(model.id)}${recommendedTag}`);
            console.log(chalk.gray(`      ${model.description}`));
            console.log(
                chalk.dim(
                    `      Size: ${formatSize(model.sizeBytes)} | ` +
                        `Context: ${model.contextLength.toLocaleString()} | ` +
                        `VRAM: ${model.minVRAM ? `${model.minVRAM}GB+` : 'CPU OK'}`
                )
            );
        }
    }

    console.log(chalk.dim('\n✓ = installed, ★ = recommended'));
    console.log(chalk.dim('Use: dexto models download <id>\n'));
}

/**
 * Handle models download command.
 */
export async function handleModelsDownloadCommand(modelId: string): Promise<void> {
    console.log(chalk.cyan(`\n📥 Downloading model: ${modelId}\n`));

    // Check if already installed
    const existingModel = await getInstalledModel(modelId);
    if (existingModel) {
        console.log(chalk.yellow(`Model '${modelId}' is already installed.`));
        console.log(chalk.gray(`  Path: ${existingModel.filePath}`));
        console.log(chalk.gray(`  Use 'dexto models remove ${modelId}' to remove it first.\n`));
        return;
    }

    // Check if model exists in registry
    const modelInfo = getLocalModelById(modelId);
    if (!modelInfo) {
        console.log(chalk.red(`❌ Model '${modelId}' not found in registry.`));
        console.log(chalk.gray('\nUse `dexto models list` to see available models.\n'));
        return;
    }

    // Show model info
    console.log(chalk.dim(`Model: ${modelInfo.name}`));
    console.log(chalk.dim(`Size: ${formatSize(modelInfo.sizeBytes)}`));
    console.log(chalk.dim(`Quantization: ${modelInfo.quantization}`));
    console.log(chalk.dim(`Context: ${modelInfo.contextLength.toLocaleString()} tokens\n`));

    // Show GPU info
    const gpuInfo = await detectGPU();
    console.log(chalk.dim(`GPU: ${formatGPUInfo(gpuInfo)}`));

    if (modelInfo.minVRAM && gpuInfo.backend !== 'cpu') {
        const vramGB = gpuInfo.vramMB ? gpuInfo.vramMB / 1024 : 0;
        if (vramGB > 0 && vramGB < modelInfo.minVRAM) {
            console.log(
                chalk.yellow(
                    `\n⚠️  This model recommends ${modelInfo.minVRAM}GB+ VRAM, you have ${vramGB.toFixed(1)}GB`
                )
            );
            console.log(chalk.gray('   Model may run slowly or require CPU fallback.\n'));
        }
    }

    // Confirm download
    const confirmed = await p.confirm({
        message: `Download ${modelInfo.name} (${formatSize(modelInfo.sizeBytes)})?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
        console.log(chalk.gray('Download cancelled.\n'));
        return;
    }

    // Create progress spinner
    const spinner = p.spinner();
    spinner.start('Starting download...');

    let lastProgress: ModelDownloadProgress | undefined;

    try {
        const result = await downloadModel(modelId, {
            targetDir: getModelsDirectory(),
            events: {
                onProgress: (progress) => {
                    lastProgress = progress;
                    const pct = progress.percentage.toFixed(1);
                    const downloaded = formatSize(progress.bytesDownloaded);
                    const total = formatSize(progress.totalBytes);
                    const speed = progress.speed ? formatSpeed(progress.speed) : '';
                    const eta = progress.eta ? `ETA: ${formatETA(progress.eta)}` : '';

                    spinner.message(`${pct}% (${downloaded}/${total}) ${speed} ${eta}`);
                },
                onComplete: (_modelId, filePath) => {
                    spinner.stop(chalk.green(`✅ Downloaded to ${filePath}`));
                },
                onError: (_modelId, error) => {
                    spinner.stop(chalk.red(`❌ Download failed: ${error.message}`));
                },
            },
        });

        // Register the downloaded model
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

        console.log(chalk.green(`\n✅ Model '${modelId}' installed successfully!`));
        console.log(chalk.gray(`   Use 'dexto models use ${modelId}' to set as active.\n`));
    } catch (error) {
        if (lastProgress?.status !== 'complete') {
            spinner.stop(chalk.red(`❌ Download failed`));
        }
        console.error(
            chalk.red(`\nError: ${error instanceof Error ? error.message : String(error)}`)
        );
        console.log(chalk.gray('The download can be resumed by running the same command again.\n'));
    }
}

/**
 * Handle models remove command.
 */
export async function handleModelsRemoveCommand(modelId: string): Promise<void> {
    console.log(chalk.cyan(`\n🗑️  Removing model: ${modelId}\n`));

    const model = await getInstalledModel(modelId);
    if (!model) {
        console.log(chalk.yellow(`Model '${modelId}' is not installed.\n`));
        return;
    }

    // Show what will be removed
    console.log(chalk.dim(`File: ${model.filePath}`));
    console.log(chalk.dim(`Size: ${formatSize(model.sizeBytes)}\n`));

    const confirmed = await p.confirm({
        message: `Remove ${modelId} (${formatSize(model.sizeBytes)})?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
        console.log(chalk.gray('Removal cancelled.\n'));
        return;
    }

    try {
        // Remove the file
        await fs.unlink(model.filePath);

        // Remove from state
        await removeInstalledModel(modelId);

        console.log(chalk.green(`\n✅ Model '${modelId}' removed.\n`));
    } catch (error) {
        console.error(
            chalk.red(
                `❌ Failed to remove: ${error instanceof Error ? error.message : String(error)}`
            )
        );
    }
}

/**
 * Handle models info command.
 */
export async function handleModelsInfoCommand(modelId: string): Promise<void> {
    console.log(chalk.cyan(`\n📄 Model Information: ${modelId}\n`));

    // Check registry first
    const registryInfo = getLocalModelById(modelId);
    const installedInfo = await getInstalledModel(modelId);
    const activeModelId = await getActiveModelId();

    if (!registryInfo && !installedInfo) {
        console.log(chalk.red(`❌ Model '${modelId}' not found.\n`));
        return;
    }

    // Registry info
    if (registryInfo) {
        console.log(chalk.green('Registry Information:'));
        console.log(`  Name: ${chalk.bold(registryInfo.name)}`);
        console.log(`  ID: ${registryInfo.id}`);
        console.log(`  Description: ${registryInfo.description}`);
        console.log(`  Categories: ${registryInfo.categories?.join(', ') || 'general'}`);
        console.log(`  Size: ${formatSize(registryInfo.sizeBytes)}`);
        console.log(`  Quantization: ${registryInfo.quantization}`);
        console.log(`  Context: ${registryInfo.contextLength.toLocaleString()} tokens`);
        console.log(
            `  Min VRAM: ${registryInfo.minVRAM ? `${registryInfo.minVRAM}GB` : 'CPU compatible'}`
        );
        console.log(`  HuggingFace: ${registryInfo.huggingfaceId}`);
        console.log(`  Filename: ${registryInfo.filename}`);
        if (registryInfo.recommended) {
            console.log(chalk.green(`  ★ Recommended`));
        }
        console.log();
    }

    // Installation info
    if (installedInfo) {
        const isActive = installedInfo.id === activeModelId;
        console.log(chalk.blue('Installation Status:'));
        console.log(chalk.green(`  ✓ Installed${isActive ? ' (active)' : ''}`));
        console.log(`  Path: ${installedInfo.filePath}`);
        console.log(`  Source: ${installedInfo.source}`);
        console.log(`  Downloaded: ${new Date(installedInfo.downloadedAt).toLocaleString()}`);
        if (installedInfo.lastUsedAt) {
            console.log(`  Last used: ${new Date(installedInfo.lastUsedAt).toLocaleString()}`);
        }
        if (installedInfo.sha256) {
            console.log(`  SHA256: ${installedInfo.sha256.substring(0, 16)}...`);
        }
    } else {
        console.log(chalk.gray('Installation Status:'));
        console.log(chalk.gray('  Not installed'));
        console.log(chalk.gray(`  Use: dexto models download ${modelId}`));
    }

    console.log();
}

/**
 * Handle models use command (set active model).
 */
export async function handleModelsUseCommand(modelId: string): Promise<void> {
    console.log(chalk.cyan(`\n⚡ Setting active model: ${modelId}\n`));

    const model = await getInstalledModel(modelId);
    if (!model) {
        console.log(chalk.red(`❌ Model '${modelId}' is not installed.`));
        console.log(chalk.gray(`   Use 'dexto models download ${modelId}' to install it first.\n`));
        return;
    }

    await setActiveModel(modelId);

    console.log(chalk.green(`✅ '${modelId}' is now the active model.\n`));
    console.log(chalk.dim('The active model will be used when provider is set to "local".'));
    console.log(chalk.dim('Configure with: dexto setup --provider local\n'));
}

/**
 * Handle models clear command (remove all).
 */
export async function handleModelsClearCommand(): Promise<void> {
    console.log(chalk.cyan('\n🗑️  Clear All Models\n'));

    const installed = await getAllInstalledModels();

    if (installed.length === 0) {
        console.log(chalk.gray('No models installed.\n'));
        return;
    }

    const totalSize = await getTotalInstalledSize();

    console.log(
        chalk.dim(`This will remove ${installed.length} model(s) (${formatSize(totalSize)})\n`)
    );

    for (const model of installed) {
        console.log(chalk.gray(`  • ${model.id} (${formatSize(model.sizeBytes)})`));
    }

    const confirmed = await p.confirm({
        message: `Remove all ${installed.length} models?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
        console.log(chalk.gray('\nClear cancelled.\n'));
        return;
    }

    let removed = 0;
    let failed = 0;

    for (const model of installed) {
        try {
            await fs.unlink(model.filePath);
            await removeInstalledModel(model.id);
            removed++;
        } catch {
            failed++;
        }
    }

    if (failed > 0) {
        console.log(
            chalk.yellow(`\n⚠️  Removed ${removed}/${installed.length} models. ${failed} failed.\n`)
        );
    } else {
        console.log(chalk.green(`\n✅ Removed all ${removed} models.\n`));
    }
}
