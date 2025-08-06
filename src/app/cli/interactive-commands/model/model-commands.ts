/**
 * Model Management Commands
 *
 * This module contains all model-related CLI commands extracted from the monolithic commands.ts.
 * These commands provide functionality for managing AI models including listing supported models,
 * switching between different models, and displaying current model configuration.
 *
 * Commands:
 * - list: List all supported providers and models with capabilities
 * - current: Show current model configuration details
 * - switch: Switch to a different AI model (provider auto-detected)
 * - help: Show detailed help for model commands
 */

import chalk from 'chalk';
import { logger } from '@core/index.js';
import { DextoAgent, DextoError } from '@core/index.js';
import { CommandDefinition } from '../command-parser.js';

/**
 * Model management command definition
 */
export const modelCommands: CommandDefinition = {
    name: 'model',
    description: 'Manage AI models',
    usage: '/model <subcommand> [args]',
    category: 'Model Management',
    aliases: ['m'],
    subcommands: [
        {
            name: 'list',
            description: 'List all supported providers and models',
            usage: '/model list',
            handler: async (_args: string[], agent: DextoAgent) => {
                try {
                    console.log(chalk.bold.blue('\n🤖 Supported Models and Providers:\n'));

                    const providers = agent.getSupportedProviders();
                    const allModels = agent.getSupportedModels();

                    for (const provider of providers) {
                        const models = allModels[provider];

                        console.log(chalk.bold.yellow(`${provider.toUpperCase()}:`));
                        console.log(chalk.cyan('  Models:'));

                        for (const model of models) {
                            const tokenLimit = ` (${model.maxInputTokens.toLocaleString()} tokens)`;
                            const defaultLabel = model.isDefault ? chalk.green(' [DEFAULT]') : '';

                            console.log(
                                `    ${chalk.cyan(model.name)}${tokenLimit}${defaultLabel}`
                            );
                        }
                        console.log();
                    }

                    console.log(chalk.dim('💡 Use /model switch <model> to switch models'));
                    console.log(chalk.dim('💡 Default models are marked with [DEFAULT]'));
                    console.log(chalk.dim('💡 Token limits show maximum input context size\n'));
                } catch (error) {
                    logger.error(
                        `Failed to list models: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
                return true;
            },
        },
        {
            name: 'current',
            description: 'Show current model configuration',
            usage: '/model current',
            handler: async (args: string[], agent: DextoAgent) => {
                try {
                    const config = agent.getEffectiveConfig();
                    console.log(chalk.blue('\n🤖 Current Model Configuration:\n'));
                    console.log(`  Provider: ${chalk.cyan(config.llm.provider)}`);
                    console.log(`  Model: ${chalk.cyan(config.llm.model)}`);
                    console.log(`  Router: ${chalk.cyan(config.llm.router)}`);

                    if (config.llm.maxIterations) {
                        console.log(
                            `  Max Iterations: ${chalk.cyan(config.llm.maxIterations.toString())}`
                        );
                    }
                    if (config.llm.maxInputTokens) {
                        console.log(
                            `  Max Input Tokens: ${chalk.cyan(config.llm.maxInputTokens.toString())}`
                        );
                    }
                    console.log();
                } catch (error) {
                    logger.error(
                        `Failed to get model info: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
                return true;
            },
        },
        {
            name: 'switch',
            description: 'Switch to a different model',
            usage: '/model switch <model>',
            handler: async (args: string[], agent: DextoAgent) => {
                if (args.length === 0) {
                    console.log(chalk.red('❌ Model required. Usage: /model switch <model>'));
                    return true;
                }

                try {
                    const model = args[0]!; // Safe to assert since we checked args.length above

                    // Infer provider from model name
                    const provider = agent.inferProviderFromModel(model);
                    if (!provider) {
                        console.log(chalk.red(`❌ Unknown model: ${model}`));
                        console.log(chalk.dim('💡 Use /model list to see available models'));
                        return true;
                    }

                    console.log(chalk.yellow(`🔄 Switching to ${model} (${provider})...`));

                    const llmConfig = { model, provider };
                    await agent.switchLLM(llmConfig);

                    console.log(chalk.green(`✅ Successfully switched to ${model} (${provider})`));
                } catch (error) {
                    if (error instanceof DextoError) {
                        console.log(chalk.red('❌ Failed to switch model:'));
                        console.log(chalk.red(`   ${error.message}`));
                        // Show warnings if any
                        const warnings = error.issues.filter(
                            (issue) => issue.severity === 'warning'
                        );
                        if (warnings.length > 0) {
                            for (const warning of warnings) {
                                console.log(chalk.yellow(`⚠️  ${warning.message}`));
                            }
                        }
                    } else {
                        logger.error(
                            `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }
                return true;
            },
        },
        {
            name: 'help',
            description: 'Show detailed help for model commands',
            usage: '/model help',
            handler: async (_args: string[], _agent: DextoAgent) => {
                console.log(chalk.bold.blue('\n🤖 Model Management Commands:\n'));

                console.log(chalk.cyan('Available subcommands:'));
                console.log(
                    `  ${chalk.yellow('/model list')} - List all supported providers, models, and capabilities`
                );
                console.log(
                    `  ${chalk.yellow('/model current')} - Display currently active model and configuration`
                );
                console.log(
                    `  ${chalk.yellow('/model switch')} ${chalk.blue('<model>')} - Switch to a different AI model (provider auto-detected)`
                );
                console.log(`        Examples:`);
                console.log(`          ${chalk.dim('/model switch gpt-4o')}`);
                console.log(`          ${chalk.dim('/model switch claude-4-sonnet-20250514')}`);
                console.log(`          ${chalk.dim('/model switch gemini-2.5-pro')}`);
                console.log(`  ${chalk.yellow('/model help')} - Show this help message`);

                console.log(
                    chalk.dim('\n💡 Switching models allows you to use different AI capabilities')
                );
                console.log(chalk.dim('💡 Model changes apply to the current session immediately'));
                console.log(chalk.dim('💡 Available providers: openai, anthropic, gemini'));
                console.log(chalk.dim('💡 Check your config file for supported models\n'));

                return true;
            },
        },
    ],
    handler: async (args: string[], agent: DextoAgent) => {
        // Default to help if no subcommand
        if (args.length === 0) {
            const helpSubcommand = modelCommands.subcommands?.find((s) => s.name === 'help');
            if (helpSubcommand) {
                return helpSubcommand.handler([], agent);
            }
            return true;
        }

        const subcommand = args[0];
        const subArgs = args.slice(1);

        // Find matching subcommand
        const subcmd = modelCommands.subcommands?.find((s) => s.name === subcommand);
        if (subcmd) {
            return subcmd.handler(subArgs, agent);
        }

        console.log(chalk.red(`❌ Unknown model subcommand: ${subcommand}`));
        console.log(chalk.dim('Available subcommands: list, current, switch, help'));
        console.log(chalk.dim('💡 Use /model help for detailed command descriptions'));
        return true;
    },
};
