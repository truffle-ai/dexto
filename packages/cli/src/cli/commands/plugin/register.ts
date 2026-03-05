import type { Command } from 'commander';
import { withAnalytics, safeExit, ExitSignal } from '../../../analytics/wrapper.js';
import type {
    PluginListCommandOptionsInput,
    PluginInstallCommandOptionsInput,
    MarketplaceListCommandOptionsInput,
    MarketplaceInstallCommandOptionsInput,
} from '../plugin.js';

export interface PluginCommandRegisterContext {
    program: Command;
}

export function registerPluginCommand({ program }: PluginCommandRegisterContext): void {
    // `plugin` SUB-COMMAND
    const pluginCommand = program.command('plugin').description('Manage plugins');

    pluginCommand
        .command('list')
        .description('List installed plugins')
        .option('--verbose', 'Show detailed plugin information')
        .action(
            withAnalytics('plugin list', async (options: PluginListCommandOptionsInput) => {
                try {
                    const { handlePluginListCommand } = await import('../plugin.js');
                    await handlePluginListCommand(options);
                    safeExit('plugin list', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto plugin list command failed: ${err}`);
                    safeExit('plugin list', 1, 'error');
                }
            })
        );

    pluginCommand
        .command('install')
        .description('Install a plugin from a local directory')
        .requiredOption('--path <path>', 'Path to the plugin directory')
        .option('--scope <scope>', 'Installation scope: user, project, or local', 'user')
        .option('--force', 'Force overwrite if already installed')
        .action(
            withAnalytics('plugin install', async (options: PluginInstallCommandOptionsInput) => {
                try {
                    const { handlePluginInstallCommand } = await import('../plugin.js');
                    await handlePluginInstallCommand(options);
                    safeExit('plugin install', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto plugin install command failed: ${err}`);
                    safeExit('plugin install', 1, 'error');
                }
            })
        );

    pluginCommand
        .command('uninstall <name>')
        .description('Uninstall a plugin by name')
        .action(
            withAnalytics('plugin uninstall', async (name: string) => {
                try {
                    const { handlePluginUninstallCommand } = await import('../plugin.js');
                    await handlePluginUninstallCommand({ name });
                    safeExit('plugin uninstall', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto plugin uninstall command failed: ${err}`);
                    safeExit('plugin uninstall', 1, 'error');
                }
            })
        );

    pluginCommand
        .command('validate [path]')
        .description('Validate a plugin directory structure')
        .action(
            withAnalytics('plugin validate', async (path?: string) => {
                try {
                    const { handlePluginValidateCommand } = await import('../plugin.js');
                    await handlePluginValidateCommand({ path: path || '.' });
                    safeExit('plugin validate', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto plugin validate command failed: ${err}`);
                    safeExit('plugin validate', 1, 'error');
                }
            })
        );

    // `plugin marketplace` SUB-COMMANDS
    const marketplaceCommand = pluginCommand
        .command('marketplace')
        .alias('market')
        .description('Manage plugin marketplaces');

    marketplaceCommand
        .command('add <source>')
        .description('Add a marketplace (GitHub: owner/repo, git URL, or local path)')
        .option('--name <name>', 'Custom name for the marketplace')
        .action(
            withAnalytics(
                'plugin marketplace add',
                async (source: string, options: { name?: string }) => {
                    try {
                        const { handleMarketplaceAddCommand } = await import('../plugin.js');
                        await handleMarketplaceAddCommand({ source, name: options.name });
                        safeExit('plugin marketplace add', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`❌ dexto plugin marketplace add command failed: ${err}`);
                        safeExit('plugin marketplace add', 1, 'error');
                    }
                }
            )
        );

    marketplaceCommand
        .command('list')
        .description('List registered marketplaces')
        .option('--verbose', 'Show detailed marketplace information')
        .action(
            withAnalytics(
                'plugin marketplace list',
                async (options: MarketplaceListCommandOptionsInput) => {
                    try {
                        const { handleMarketplaceListCommand } = await import('../plugin.js');
                        await handleMarketplaceListCommand(options);
                        safeExit('plugin marketplace list', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`❌ dexto plugin marketplace list command failed: ${err}`);
                        safeExit('plugin marketplace list', 1, 'error');
                    }
                }
            )
        );

    marketplaceCommand
        .command('remove <name>')
        .alias('rm')
        .description('Remove a registered marketplace')
        .action(
            withAnalytics('plugin marketplace remove', async (name: string) => {
                try {
                    const { handleMarketplaceRemoveCommand } = await import('../plugin.js');
                    await handleMarketplaceRemoveCommand({ name });
                    safeExit('plugin marketplace remove', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto plugin marketplace remove command failed: ${err}`);
                    safeExit('plugin marketplace remove', 1, 'error');
                }
            })
        );

    marketplaceCommand
        .command('update [name]')
        .description('Update marketplace(s) from remote (git pull)')
        .action(
            withAnalytics('plugin marketplace update', async (name?: string) => {
                try {
                    const { handleMarketplaceUpdateCommand } = await import('../plugin.js');
                    await handleMarketplaceUpdateCommand({ name });
                    safeExit('plugin marketplace update', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto plugin marketplace update command failed: ${err}`);
                    safeExit('plugin marketplace update', 1, 'error');
                }
            })
        );

    marketplaceCommand
        .command('plugins [marketplace]')
        .description('List plugins available in marketplaces')
        .option('--verbose', 'Show plugin descriptions')
        .action(
            withAnalytics(
                'plugin marketplace plugins',
                async (marketplace?: string, options?: { verbose?: boolean }) => {
                    try {
                        const { handleMarketplacePluginsCommand } = await import('../plugin.js');
                        await handleMarketplacePluginsCommand({
                            marketplace,
                            verbose: options?.verbose,
                        });
                        safeExit('plugin marketplace plugins', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`❌ dexto plugin marketplace plugins command failed: ${err}`);
                        safeExit('plugin marketplace plugins', 1, 'error');
                    }
                }
            )
        );

    marketplaceCommand
        .command('install <plugin>')
        .description('Install a plugin from marketplace (plugin or plugin@marketplace)')
        .option('--scope <scope>', 'Installation scope: user, project, or local', 'user')
        .option('--force', 'Force reinstall if already exists')
        .action(
            withAnalytics(
                'plugin marketplace install',
                async (plugin: string, options: MarketplaceInstallCommandOptionsInput) => {
                    try {
                        const { handleMarketplaceInstallCommand } = await import('../plugin.js');
                        await handleMarketplaceInstallCommand({ ...options, plugin });
                        safeExit('plugin marketplace install', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`❌ dexto plugin marketplace install command failed: ${err}`);
                        safeExit('plugin marketplace install', 1, 'error');
                    }
                }
            )
        );
}
