/**
 * Image CLI Command Handlers
 *
 * Handles CLI commands for image management:
 * - dexto image install <image>
 * - dexto image list
 * - dexto image use <image@version>
 * - dexto image remove <image>[@version]
 * - dexto image doctor
 */

import chalk from 'chalk';
import { z } from 'zod';
import {
    getDefaultImageStoreDir,
    getImagePackagesDir,
    getImageRegistryPath,
    loadImageRegistry,
    parseImageSpecifier,
    removeImageFromStore,
    setActiveImageVersion,
} from '@dexto/agent-management';
import { installImageToStore } from '../utils/image-store.js';

const ImageInstallCommandSchema = z
    .object({
        image: z.string().min(1),
        force: z.boolean().default(false),
        activate: z.boolean().default(true),
    })
    .strict();

const ImageUseCommandSchema = z
    .object({
        image: z.string().min(1),
    })
    .strict();

const ImageRemoveCommandSchema = z
    .object({
        image: z.string().min(1),
    })
    .strict();

export type ImageInstallCommandOptions = z.output<typeof ImageInstallCommandSchema>;
export type ImageInstallCommandOptionsInput = z.input<typeof ImageInstallCommandSchema>;

/**
 * Install an image into the Dexto-managed image store (~/.dexto/images).
 */
export async function handleImageInstallCommand(
    options: ImageInstallCommandOptionsInput
): Promise<void> {
    const validated = ImageInstallCommandSchema.parse(options);
    const result = await installImageToStore(validated.image, {
        force: validated.force,
        activate: validated.activate,
    });

    console.log(chalk.green(`✓ Installed ${result.id}@${result.version}`));
    console.log(chalk.dim(`  Store: ${getDefaultImageStoreDir()}`));
    console.log(chalk.dim(`  Entry: ${result.entryFile}`));
}

/**
 * List installed images from the local store.
 */
export async function handleImageListCommand(): Promise<void> {
    const storeDir = getDefaultImageStoreDir();
    const registry = loadImageRegistry(storeDir);
    const ids = Object.keys(registry.images).sort();

    if (ids.length === 0) {
        console.log(chalk.yellow('No images installed.'));
        console.log('');
        console.log('Install one with:');
        console.log(chalk.cyan('  dexto image install <package-or-path>'));
        return;
    }

    console.log(chalk.bold(`Installed Images (${ids.length}):`));
    console.log('');

    for (const id of ids) {
        const entry = registry.images[id];
        if (!entry) continue;
        const active = entry.active;
        const versions = Object.keys(entry.installed).sort();

        const versionLabel = active
            ? `${chalk.green(active)}${versions.length > 1 ? chalk.dim(` (+${versions.length - 1})`) : ''}`
            : chalk.dim('(no active version)');

        console.log(`  ${chalk.cyan(id)} ${versionLabel}`);
    }

    console.log('');
    console.log(chalk.dim(`Registry: ${getImageRegistryPath(storeDir)}`));
    console.log(chalk.dim(`Packages: ${getImagePackagesDir(storeDir)}`));
}

/**
 * Set active version for an installed image.
 */
export async function handleImageUseCommand(options: { image: string }): Promise<void> {
    const validated = ImageUseCommandSchema.parse(options);
    const parsed = parseImageSpecifier(validated.image);
    if (!parsed.version) {
        throw new Error(`Expected '<image>@<version>' (got '${validated.image}')`);
    }

    await setActiveImageVersion(parsed.id, parsed.version);
    console.log(chalk.green(`✓ Set active ${parsed.id}@${parsed.version}`));
}

/**
 * Remove an image (all versions) or a specific version from the store.
 */
export async function handleImageRemoveCommand(options: { image: string }): Promise<void> {
    const validated = ImageRemoveCommandSchema.parse(options);
    const parsed = parseImageSpecifier(validated.image);

    await removeImageFromStore(parsed.id, {
        ...(parsed.version ? { version: parsed.version } : {}),
    });

    console.log(
        chalk.green(
            parsed.version
                ? `✓ Removed ${parsed.id}@${parsed.version}`
                : `✓ Removed ${parsed.id} (all versions)`
        )
    );
}

/**
 * Print diagnostics about the local image store.
 */
export async function handleImageDoctorCommand(): Promise<void> {
    const storeDir = getDefaultImageStoreDir();
    const registryPath = getImageRegistryPath(storeDir);
    const packagesDir = getImagePackagesDir(storeDir);

    const registry = loadImageRegistry(storeDir);
    const imageCount = Object.keys(registry.images).length;

    console.log(chalk.bold('Image Store:'));
    console.log(chalk.dim(`  Store:    ${storeDir}`));
    console.log(chalk.dim(`  Registry: ${registryPath}`));
    console.log(chalk.dim(`  Packages: ${packagesDir}`));
    console.log(chalk.dim(`  Images:   ${imageCount}`));
}
