import { z } from 'zod';
import {
    createNativeInstallCommand,
    detectInstallMethod,
    detectUnsupportedPackageManagerFromPath,
    executeManagedCommand,
    normalizeRequestedVersion,
    resolveUninstallCommandForMethod,
} from '../utils/self-management.js';

const UpgradeCommandSchema = z
    .object({
        dryRun: z.boolean().default(false),
        force: z.boolean().default(false),
    })
    .strict();

export type UpgradeCommandOptions = z.output<typeof UpgradeCommandSchema>;

function printMultiInstallWarning(warning: string | null): void {
    if (!warning) {
        return;
    }

    console.warn(`⚠️  ${warning}`);
}

async function runNativeUpgrade(
    version: string | null,
    installDir: string | null,
    options: UpgradeCommandOptions
): Promise<void> {
    const nativeCommand = createNativeInstallCommand({
        version,
        installDir,
        force: options.force,
    });

    console.log('⬆️  Upgrading Dexto via native installer...');
    await executeManagedCommand(nativeCommand, { dryRun: options.dryRun });
}

async function runHardMigrationToNative(
    method: 'npm',
    version: string | null,
    options: UpgradeCommandOptions
): Promise<void> {
    console.log(`🔁 Detected ${method} global install. Migrating to native installer...`);

    await runNativeUpgrade(version, null, options);

    const uninstallCommand = resolveUninstallCommandForMethod(method);
    if (!uninstallCommand) {
        throw new Error(`No uninstall command available for install method: ${method}`);
    }

    console.log(`🧹 Removing legacy ${method} global install...`);

    try {
        await executeManagedCommand(
            {
                command: uninstallCommand.command,
                args: uninstallCommand.args,
                displayCommand: uninstallCommand.displayCommand,
            },
            { dryRun: options.dryRun }
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`⚠️  Automatic ${method} uninstall failed: ${message}`);
        console.warn(`Run this command manually: ${uninstallCommand.displayCommand}`);
    }
}

function getUnsupportedCleanupHint(manager: 'pnpm' | 'bun'): string {
    if (manager === 'pnpm') {
        return 'pnpm unlink --global dexto (linked/source) or pnpm remove -g dexto (global package)';
    }

    return 'bun remove -g dexto';
}

export async function handleUpgradeCommand(
    versionArg: string | undefined,
    options: Partial<UpgradeCommandOptions>
): Promise<void> {
    const validated = UpgradeCommandSchema.parse(options);
    const version = normalizeRequestedVersion(versionArg);

    const detection = await detectInstallMethod();
    printMultiInstallWarning(detection.multipleInstallWarning);

    if (version) {
        console.log(`🎯 Target version: ${version}`);
    } else {
        console.log('🎯 Target version: latest');
    }

    switch (detection.method) {
        case 'native':
            await runNativeUpgrade(version, detection.installDir, validated);
            break;
        case 'npm':
            await runHardMigrationToNative(detection.method, version, validated);
            break;
        case 'unknown':
        default:
            if (detection.installedPath) {
                const unsupportedManager = detectUnsupportedPackageManagerFromPath(
                    detection.installedPath
                );
                if (unsupportedManager) {
                    console.warn(
                        `⚠️  Active binary appears to come from ${unsupportedManager}. ` +
                            'Dexto only auto-migrates npm installs.'
                    );
                }
            }
            console.warn(
                '⚠️  Could not determine install method. Falling back to native installer upgrade.'
            );
            await runNativeUpgrade(version, null, validated);
            break;
    }

    const postDetection = await detectInstallMethod();
    printMultiInstallWarning(postDetection.multipleInstallWarning);

    if (postDetection.method !== 'native' && postDetection.installedPath) {
        const unsupportedManager = detectUnsupportedPackageManagerFromPath(
            postDetection.installedPath
        );
        const followUp = unsupportedManager
            ? `Run ${getUnsupportedCleanupHint(unsupportedManager)}, then run dexto upgrade again.`
            : 'Remove the stale binary from PATH, then run dexto upgrade again.';
        const message =
            `Upgrade completed, but active binary is still non-native: ${postDetection.installedPath}. ` +
            followUp;

        if (validated.dryRun) {
            console.warn(`⚠️  ${message}`);
        } else {
            throw new Error(message);
        }
    }

    if (validated.dryRun) {
        console.log('✅ Dry run completed. No changes were made.');
        return;
    }

    console.log('✅ Dexto upgrade completed.');
}
