/**
 * Plugin Management Commands (Interactive CLI)
 *
 * This module contains plugin-related commands for the interactive CLI.
 * Commands:
 * - /plugin list [--verbose] - List installed plugins
 * - /plugin install --path <path> [--scope <scope>] [--force] - Install a plugin
 * - /plugin uninstall <name> - Uninstall a plugin
 * - /plugin validate [path] - Validate a plugin directory
 * - /plugin import [name] - Import a Claude Code plugin
 */

import chalk from 'chalk';
import * as path from 'path';
import type { DextoAgent } from '@dexto/core';
import {
    listInstalledPlugins,
    installPluginFromPath,
    uninstallPlugin,
    validatePluginDirectory,
    listClaudeCodePlugins,
    importClaudeCodePlugin,
    type PluginInstallScope,
} from '@dexto/agent-management';
import type { CommandDefinition, CommandContext, CommandHandlerResult } from '../command-parser.js';
import { formatForInkCli } from '../utils/format-output.js';
import { parseOptions } from '../utils/arg-parser.js';

/**
 * Plugin list subcommand
 */
const pluginListCommand: CommandDefinition = {
    name: 'list',
    description: 'List installed plugins',
    usage: '/plugin list [--verbose]',
    handler: async (
        args: string[],
        _agent: DextoAgent,
        _ctx: CommandContext
    ): Promise<CommandHandlerResult> => {
        const { flags } = parseOptions(args);
        const verbose = flags.has('verbose');

        const plugins = listInstalledPlugins();

        if (plugins.length === 0) {
            const output = [
                chalk.yellow('No plugins installed.'),
                '',
                'Install a plugin with:',
                chalk.cyan('  /plugin install --path <path-to-plugin>'),
            ].join('\n');
            return formatForInkCli(output);
        }

        const lines: string[] = [chalk.bold(`Installed Plugins (${plugins.length}):`), ''];

        for (const plugin of plugins) {
            const sourceLabel = getSourceLabel(plugin.source);
            const scopeLabel = plugin.scope ? ` [${plugin.scope}]` : '';
            const version = plugin.version || 'unknown';

            lines.push(
                `  ${chalk.green(plugin.name)}${chalk.dim('@' + version)} ${sourceLabel}${scopeLabel}`
            );

            if (verbose) {
                if (plugin.description) {
                    lines.push(chalk.dim(`    ${plugin.description}`));
                }
                lines.push(chalk.dim(`    Path: ${plugin.path}`));
                if (plugin.installedAt) {
                    const date = new Date(plugin.installedAt).toLocaleDateString();
                    lines.push(chalk.dim(`    Installed: ${date}`));
                }
            }
        }

        lines.push('');
        return formatForInkCli(lines.join('\n'));
    },
};

/**
 * Plugin install subcommand
 */
const pluginInstallCommand: CommandDefinition = {
    name: 'install',
    description: 'Install a plugin from a local directory',
    usage: '/plugin install --path <path> [--scope user|project|local] [--force]',
    handler: async (
        args: string[],
        _agent: DextoAgent,
        _ctx: CommandContext
    ): Promise<CommandHandlerResult> => {
        const { options, flags } = parseOptions(args);

        const pluginPath = options.path;
        const scope = (options.scope as PluginInstallScope) || 'user';
        const force = flags.has('force');

        if (!pluginPath) {
            return formatForInkCli(
                chalk.red('Missing required --path argument\n') +
                    chalk.dim('Usage: /plugin install --path <path-to-plugin>')
            );
        }

        // Validate scope
        if (!['user', 'project', 'local'].includes(scope)) {
            return formatForInkCli(
                chalk.red(`Invalid scope: ${scope}\n`) +
                    chalk.dim('Valid scopes: user, project, local')
            );
        }

        try {
            const absolutePath = path.isAbsolute(pluginPath)
                ? pluginPath
                : path.resolve(pluginPath);

            const result = await installPluginFromPath(absolutePath, {
                scope,
                force,
            });

            const lines: string[] = [];

            // Show warnings
            if (result.warnings.length > 0) {
                lines.push(chalk.yellow('Warnings:'));
                for (const warning of result.warnings) {
                    lines.push(chalk.yellow(`  - ${warning}`));
                }
                lines.push('');
            }

            lines.push(chalk.green(`Successfully installed plugin '${result.pluginName}'`));
            lines.push(chalk.dim(`  Path: ${result.installPath}`));
            lines.push('');

            return formatForInkCli(lines.join('\n'));
        } catch (error) {
            return formatForInkCli(
                chalk.red(
                    `Failed to install plugin: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    },
};

/**
 * Plugin uninstall subcommand
 */
const pluginUninstallCommand: CommandDefinition = {
    name: 'uninstall',
    description: 'Uninstall a plugin by name',
    usage: '/plugin uninstall <name>',
    handler: async (
        args: string[],
        _agent: DextoAgent,
        _ctx: CommandContext
    ): Promise<CommandHandlerResult> => {
        const pluginName = args[0];

        if (!pluginName) {
            return formatForInkCli(
                chalk.red('Missing plugin name\n') + chalk.dim('Usage: /plugin uninstall <name>')
            );
        }

        try {
            const result = await uninstallPlugin(pluginName);

            const lines: string[] = [
                chalk.green(`Successfully uninstalled plugin '${pluginName}'`),
            ];

            if (result.removedPath) {
                lines.push(chalk.dim(`  Removed: ${result.removedPath}`));
            }

            lines.push('');
            return formatForInkCli(lines.join('\n'));
        } catch (error) {
            return formatForInkCli(
                chalk.red(
                    `Failed to uninstall plugin: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    },
};

/**
 * Plugin validate subcommand
 */
const pluginValidateCommand: CommandDefinition = {
    name: 'validate',
    description: 'Validate a plugin directory structure',
    usage: '/plugin validate [path]',
    handler: async (
        args: string[],
        _agent: DextoAgent,
        _ctx: CommandContext
    ): Promise<CommandHandlerResult> => {
        const pluginPath = args[0] || '.';
        const absolutePath = path.isAbsolute(pluginPath) ? pluginPath : path.resolve(pluginPath);

        const result = validatePluginDirectory(absolutePath);
        const lines: string[] = [];

        if (result.valid) {
            lines.push(chalk.green('Plugin is valid!'));
            lines.push('');

            if (result.manifest) {
                lines.push(chalk.bold('Manifest:'));
                lines.push(`  Name: ${chalk.green(result.manifest.name)}`);
                if (result.manifest.description) {
                    lines.push(`  Description: ${result.manifest.description}`);
                }
                if (result.manifest.version) {
                    lines.push(`  Version: ${result.manifest.version}`);
                }
                lines.push('');
            }
        } else {
            lines.push(chalk.red('Plugin validation failed!'));
            lines.push('');
        }

        // Show errors
        if (result.errors.length > 0) {
            lines.push(chalk.red('Errors:'));
            for (const error of result.errors) {
                lines.push(chalk.red(`  - ${error}`));
            }
            lines.push('');
        }

        // Show warnings
        if (result.warnings.length > 0) {
            lines.push(chalk.yellow('Warnings:'));
            for (const warning of result.warnings) {
                lines.push(chalk.yellow(`  - ${warning}`));
            }
            lines.push('');
        }

        return formatForInkCli(lines.join('\n'));
    },
};

/**
 * Plugin import subcommand
 */
const pluginImportCommand: CommandDefinition = {
    name: 'import',
    description: 'Import a Claude Code plugin into Dexto',
    usage: '/plugin import [name]',
    handler: async (
        args: string[],
        _agent: DextoAgent,
        _ctx: CommandContext
    ): Promise<CommandHandlerResult> => {
        const pluginName = args[0];

        // List available Claude Code plugins
        const claudePlugins = listClaudeCodePlugins();

        if (claudePlugins.length === 0) {
            const output = [
                chalk.yellow('No Claude Code plugins found.'),
                '',
                'Claude Code plugins are typically installed at:',
                chalk.dim('  ~/.claude/plugins/'),
            ].join('\n');
            return formatForInkCli(output);
        }

        // If no name provided, list available plugins
        if (!pluginName) {
            const lines: string[] = [chalk.bold('Claude Code Plugins Available for Import:'), ''];

            const notImported = claudePlugins.filter((p) => !p.isImported);
            const imported = claudePlugins.filter((p) => p.isImported);

            if (notImported.length > 0) {
                lines.push(chalk.cyan('Not yet imported:'));
                for (const plugin of notImported) {
                    lines.push(
                        `  ${chalk.green(plugin.name)}${chalk.dim('@' + (plugin.version || 'unknown'))}`
                    );
                    if (plugin.description) {
                        lines.push(chalk.dim(`    ${plugin.description}`));
                    }
                }
                lines.push('');
            }

            if (imported.length > 0) {
                lines.push(chalk.dim('Already imported:'));
                for (const plugin of imported) {
                    lines.push(
                        chalk.dim(`  ${plugin.name}@${plugin.version || 'unknown'} (imported)`)
                    );
                }
                lines.push('');
            }

            lines.push('To import a plugin, run:');
            lines.push(chalk.cyan('  /plugin import <name>'));
            return formatForInkCli(lines.join('\n'));
        }

        // Import the specified plugin
        try {
            const result = await importClaudeCodePlugin(pluginName);

            const lines: string[] = [
                chalk.green(`Successfully imported plugin '${result.pluginName}'`),
                chalk.dim(`  Path: ${result.pluginPath}`),
                '',
            ];

            return formatForInkCli(lines.join('\n'));
        } catch (error) {
            return formatForInkCli(
                chalk.red(
                    `Failed to import plugin: ${error instanceof Error ? error.message : String(error)}`
                )
            );
        }
    },
};

/**
 * Main plugin command with subcommands
 */
export const pluginCommands: CommandDefinition = {
    name: 'plugin',
    description: 'Manage Claude Code compatible plugins',
    usage: '/plugin <list|install|uninstall|validate|import>',
    category: 'Plugin Management',
    aliases: ['plugins'],
    subcommands: [
        pluginListCommand,
        pluginInstallCommand,
        pluginUninstallCommand,
        pluginValidateCommand,
        pluginImportCommand,
    ],
    handler: async (
        args: string[],
        agent: DextoAgent,
        ctx: CommandContext
    ): Promise<CommandHandlerResult> => {
        const subcommand = args[0];
        const subArgs = args.slice(1);

        // Find and execute subcommand
        const subcommands: Record<string, CommandDefinition> = {
            list: pluginListCommand,
            install: pluginInstallCommand,
            uninstall: pluginUninstallCommand,
            validate: pluginValidateCommand,
            import: pluginImportCommand,
        };

        if (subcommand && subcommands[subcommand]) {
            return subcommands[subcommand].handler(subArgs, agent, ctx);
        }

        // No subcommand or unknown subcommand - show help
        const helpLines = [
            chalk.bold('Plugin Management Commands'),
            '',
            chalk.cyan('/plugin list') + ' [--verbose]',
            '  List all installed plugins',
            '',
            chalk.cyan('/plugin install') + ' --path <path> [--scope user|project|local] [--force]',
            '  Install a plugin from a local directory',
            '  Scopes:',
            '    user    - Install to ~/.dexto/plugins/ (default)',
            '    project - Install to .dexto/plugins/',
            '    local   - Register in-place (no copy)',
            '',
            chalk.cyan('/plugin uninstall') + ' <name>',
            '  Uninstall a plugin by name',
            '',
            chalk.cyan('/plugin validate') + ' [path]',
            '  Validate a plugin directory structure',
            '',
            chalk.cyan('/plugin import') + ' [name]',
            '  Import a Claude Code plugin into Dexto',
            '  Lists available plugins if no name provided',
            '',
        ];

        return formatForInkCli(helpLines.join('\n'));
    },
};

/**
 * Gets a display label for the plugin source.
 */
function getSourceLabel(source: 'dexto' | 'claude-code' | 'directory'): string {
    switch (source) {
        case 'dexto':
            return chalk.blue('(dexto)');
        case 'claude-code':
            return chalk.magenta('(claude-code)');
        case 'directory':
            return chalk.dim('(directory)');
        default:
            return '';
    }
}
