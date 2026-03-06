import path from 'path';
import { z } from 'zod';
import {
    detectInstallMethod,
    executeManagedCommand,
    getDefaultNativeBinaryPath,
    getDextoHomePath,
    pathExists,
    removePath,
    resolveUninstallCommandForMethod,
    scheduleDeferredWindowsRemoval,
} from '../utils/self-management.js';

const UninstallCliCommandSchema = z
    .object({
        purge: z.boolean().default(false),
        dryRun: z.boolean().default(false),
    })
    .strict();

export type UninstallCliCommandOptions = z.output<typeof UninstallCliCommandSchema>;

interface RemovalSummary {
    removed: string[];
    skipped: string[];
}

function printMultiInstallWarning(warning: string | null): void {
    if (!warning) {
        return;
    }

    console.warn(`⚠️  ${warning}`);
}

async function removeTargets(targets: string[], dryRun: boolean): Promise<RemovalSummary> {
    const removed: string[] = [];
    const skipped: string[] = [];

    for (const target of targets) {
        if (!(await pathExists(target))) {
            skipped.push(target);
            continue;
        }

        if (dryRun) {
            console.log(`[dry-run] remove ${target}`);
            removed.push(target);
            continue;
        }

        await removePath(target);
        removed.push(target);
    }

    return { removed, skipped };
}

function normalizeRuntimePath(targetPath: string): string {
    const normalized = path.normalize(targetPath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isCurrentExecutable(binaryPath: string): boolean {
    return normalizeRuntimePath(binaryPath) === normalizeRuntimePath(process.execPath);
}

function buildProjectLocalInstallMessage(
    binaryPath: string | null,
    action: 'uninstall' | 'upgrade'
): string {
    const resolvedPath = binaryPath ?? 'node_modules/.bin/dexto';
    return [
        `Project-local install detected at ${resolvedPath}.`,
        `Self-${action} is only available for native installs and legacy global npm installs.`,
        'Use the owning project package manager instead.',
    ].join(' ');
}

export async function handleUninstallCliCommand(
    options: Partial<UninstallCliCommandOptions>
): Promise<void> {
    const validated = UninstallCliCommandSchema.parse(options);
    const detection = await detectInstallMethod();
    printMultiInstallWarning(detection.multipleInstallWarning);

    if (detection.method === 'project-local') {
        throw new Error(buildProjectLocalInstallMessage(detection.installedPath, 'uninstall'));
    }

    const dextoHomePath = getDextoHomePath();
    let managedUninstallError: Error | null = null;
    let binaryRemovalError: Error | null = null;
    let homeRemovalDeferred = false;

    if (detection.method === 'npm') {
        const command = resolveUninstallCommandForMethod(detection.method);
        if (command) {
            console.log(`🧹 Uninstalling CLI via ${detection.method}...`);
            try {
                await executeManagedCommand(
                    {
                        command: command.command,
                        args: command.args,
                        displayCommand: command.displayCommand,
                    },
                    { dryRun: validated.dryRun }
                );
            } catch (error) {
                managedUninstallError = error instanceof Error ? error : new Error(String(error));
                console.warn(
                    `⚠️  Package-manager uninstall failed: ${managedUninstallError.message}`
                );
            }
        } else {
            console.warn(
                `⚠️  No automatic uninstall command for ${detection.method}. Remove it manually.`
            );
        }
    } else {
        const binaryPath = detection.installedPath ?? getDefaultNativeBinaryPath();

        try {
            if (
                process.platform === 'win32' &&
                isCurrentExecutable(binaryPath) &&
                !validated.dryRun
            ) {
                const deferredTargets = validated.purge
                    ? [binaryPath, dextoHomePath]
                    : [binaryPath];
                await scheduleDeferredWindowsRemoval(deferredTargets);
                homeRemovalDeferred = validated.purge;
                console.log('🗑️  Scheduled CLI binary removal after exit.');
                if (validated.purge) {
                    console.log(`🗑️  Scheduled ${dextoHomePath} removal after exit.`);
                }
            } else {
                const binaryRemoval = await removeTargets([binaryPath], validated.dryRun);
                if (binaryRemoval.removed.length > 0) {
                    console.log(`🗑️  Removed CLI binary: ${binaryRemoval.removed.join(', ')}`);
                } else {
                    console.log('ℹ️  CLI binary was not found at expected path.');
                }
            }
        } catch (error) {
            binaryRemovalError = error instanceof Error ? error : new Error(String(error));
            console.warn(`⚠️  Binary removal failed: ${binaryRemovalError.message}`);
        }
    }

    if (validated.purge && !homeRemovalDeferred) {
        const homeRemoval = await removeTargets([dextoHomePath], validated.dryRun);
        if (homeRemoval.removed.length > 0) {
            console.log(`🗑️  Removed ${dextoHomePath}.`);
        } else {
            console.log(`ℹ️  ${dextoHomePath} was not found.`);
        }
    } else if (!validated.purge) {
        console.log(`ℹ️  Keeping ${dextoHomePath}.`);
    }

    if (validated.dryRun) {
        console.log('✅ Dry run completed. No files were deleted.');
        return;
    }

    if (managedUninstallError) {
        throw managedUninstallError;
    }

    if (binaryRemovalError) {
        throw binaryRemovalError;
    }

    console.log('✅ Dexto CLI uninstall completed.');
}
