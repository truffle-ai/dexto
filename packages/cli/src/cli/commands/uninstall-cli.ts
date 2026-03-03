import { z } from 'zod';
import {
    detectInstallMethod,
    executeManagedCommand,
    getDefaultNativeBinaryPath,
    getSelfUninstallPaths,
    pathExists,
    removePath,
    resolveUninstallCommandForMethod,
} from '../utils/self-management.js';

const UninstallCliCommandSchema = z
    .object({
        keepConfig: z.boolean().default(true),
        keepData: z.boolean().default(true),
        removeConfig: z.boolean().default(false),
        removeData: z.boolean().default(false),
        dryRun: z.boolean().default(false),
        force: z.boolean().default(false),
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

function resolveKeepFlags(options: UninstallCliCommandOptions): {
    keepConfig: boolean;
    keepData: boolean;
} {
    const keepConfig = options.keepConfig && !options.removeConfig;
    const keepData = options.keepData && !options.removeData;

    return { keepConfig, keepData };
}

export async function handleUninstallCliCommand(
    options: Partial<UninstallCliCommandOptions>
): Promise<void> {
    const validated = UninstallCliCommandSchema.parse(options);
    const keep = resolveKeepFlags(validated);

    if ((!keep.keepConfig || !keep.keepData) && !validated.force && !validated.dryRun) {
        throw new Error(
            'Removing config/data requires --force. Re-run with --force or keep defaults.'
        );
    }

    const detection = await detectInstallMethod();
    printMultiInstallWarning(detection.multipleInstallWarning);

    const uninstallPaths = getSelfUninstallPaths();

    if (
        detection.method === 'npm' ||
        detection.method === 'pnpm' ||
        detection.method === 'bun' ||
        detection.method === 'brew' ||
        detection.method === 'choco' ||
        detection.method === 'scoop'
    ) {
        const command = resolveUninstallCommandForMethod(detection.method);
        if (command) {
            console.log(`🧹 Uninstalling CLI via ${detection.method}...`);
            await executeManagedCommand(
                {
                    command: command.command,
                    args: command.args,
                    displayCommand: command.displayCommand,
                },
                { dryRun: validated.dryRun }
            );
        } else {
            console.warn(
                `⚠️  No automatic uninstall command for ${detection.method}. Remove it manually.`
            );
        }
    } else {
        const binaryPath = detection.installedPath ?? getDefaultNativeBinaryPath();
        const binaryRemoval = await removeTargets([binaryPath], validated.dryRun);

        if (binaryRemoval.removed.length > 0) {
            console.log(`🗑️  Removed CLI binary: ${binaryRemoval.removed.join(', ')}`);
        } else {
            console.log('ℹ️  CLI binary was not found at expected path.');
        }
    }

    const cacheRemoval = await removeTargets(uninstallPaths.cachePaths, validated.dryRun);
    if (cacheRemoval.removed.length > 0) {
        console.log('🗑️  Removed cache data.');
    }

    if (!keep.keepConfig) {
        const configRemoval = await removeTargets(uninstallPaths.configPaths, validated.dryRun);
        if (configRemoval.removed.length > 0) {
            console.log('🗑️  Removed config files.');
        }
    } else {
        console.log('ℹ️  Keeping config files.');
    }

    if (!keep.keepData) {
        const dataRemoval = await removeTargets(uninstallPaths.dataPaths, validated.dryRun);
        if (dataRemoval.removed.length > 0) {
            console.log('🗑️  Removed data directories.');
        }
    } else {
        console.log('ℹ️  Keeping data directories.');
    }

    if (validated.dryRun) {
        console.log('✅ Dry run completed. No files were deleted.');
        return;
    }

    console.log('✅ Dexto CLI uninstall completed.');
}
