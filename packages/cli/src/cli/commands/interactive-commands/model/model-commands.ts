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
import { DextoAgent, DextoRuntimeError, DextoValidationError } from '@dexto/core';
import { CommandDefinition, CommandHandlerResult } from '../command-parser.js';
import { CommandOutputHelper } from '../utils/command-output.js';

/**
 * Model management command definition
 * Note: In interactive CLI, /model shows the interactive selector
 * Subcommands available for debugging/advanced use, but not emphasized
 */
export const modelCommands: CommandDefinition = {
    name: 'model',
    description: 'Switch AI model (interactive selector)',
    usage: '/model',
    category: 'General',
    aliases: ['m'],
    subcommands: [
        {
            name: 'list',
            description: 'List all supported providers and models',
            usage: '/model list',
            handler: async (_args: string[], agent: DextoAgent): Promise<boolean | string> => {
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
                    return CommandOutputHelper.noOutput(); // List is displayed above
                } catch (error) {
                    return CommandOutputHelper.error(error, 'Failed to list models');
                }
            },
        },
        {
            name: 'current',
            description: 'Show current model configuration',
            usage: '/model current',
            handler: async (args: string[], agent: DextoAgent): Promise<boolean | string> => {
                try {
                    const config = agent.getEffectiveConfig();
                    console.log(chalk.blue('\n🤖 Current Model Configuration:\n'));
                    console.log(`  Provider: ${chalk.cyan(config.llm.provider)}`);
                    console.log(`  Model: ${chalk.cyan(config.llm.model)}`);

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
                    return CommandOutputHelper.noOutput(); // Config is displayed above
                } catch (error) {
                    return CommandOutputHelper.error(error, 'Failed to get model info');
                }
            },
        },
        {
            name: 'switch',
            description: 'Switch to a different model',
            usage: '/model switch <model>',
            handler: async (args: string[], agent: DextoAgent): Promise<boolean | string> => {
                const validationError = CommandOutputHelper.validateRequiredArg(
                    args,
                    0,
                    'Model name',
                    '/model switch <model>'
                );
                if (validationError) return validationError;

                const model = args[0] || '';
                try {
                    // Infer provider from model name
                    const provider = agent.inferProviderFromModel(model);
                    if (!provider) {
                        return CommandOutputHelper.error(
                            new Error(
                                `Unknown model: ${model}\n💡 Use /model list to see available models`
                            )
                        );
                    }

                    console.log(chalk.yellow(`🔄 Switching to ${model} (${provider})...`));

                    const llmConfig = { model, provider };
                    await agent.switchLLM(llmConfig);

                    return CommandOutputHelper.success(
                        `✅ Successfully switched to ${model} (${provider})`
                    );
                } catch (error: unknown) {
                    if (error instanceof DextoRuntimeError) {
                        const errorLines = [
                            `Failed to switch model:\n   ${error.message}\n   Code: ${error.code}`,
                        ];
                        if (error.recovery) {
                            const recoverySteps = Array.isArray(error.recovery)
                                ? error.recovery
                                : [error.recovery];
                            errorLines.push(...recoverySteps.map((step) => `💡 ${step}`));
                        }
                        console.log(chalk.red(errorLines.join('\n')));
                        return CommandOutputHelper.error(new Error(errorLines.join('\n')));
                    } else if (error instanceof DextoValidationError) {
                        const errors = error.errors.map((e) => `   - ${e.message}`).join('\n');
                        return CommandOutputHelper.error(
                            new Error(`Validation failed:\n${errors}`)
                        );
                    }
                    return CommandOutputHelper.error(error, 'Failed to switch model');
                }
            },
        },
        {
            name: 'help',
            description: 'Show detailed help for model commands',
            usage: '/model help',
            handler: async (_args: string[], _agent: DextoAgent): Promise<boolean | string> => {
                const helpText = [
                    '\n🤖 Model Management Commands:\n',
                    'Available subcommands:',
                    '  /model list - List all supported providers, models, and capabilities',
                    '  /model current - Display currently active model and configuration',
                    '  /model switch <model> - Switch to a different AI model (provider auto-detected)',
                    '    Examples:',
                    '      /model switch gpt-5',
                    '      /model switch claude-sonnet-4-5-20250929',
                    '      /model switch gemini-2.5-pro',
                    '  /model help - Show this help message',
                    '\n💡 Switching models allows you to use different AI capabilities',
                    '💡 Model changes apply to the current session immediately',
                    '💡 Available providers: openai, anthropic, gemini',
                    '💡 You can also press Ctrl+M for interactive model selector\n',
                ].join('\n');

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
                console.log(`          ${chalk.dim('/model switch gpt-5')}`);
                console.log(`          ${chalk.dim('/model switch claude-sonnet-4-5-20250929')}`);
                console.log(`          ${chalk.dim('/model switch gemini-2.5-pro')}`);
                console.log(`  ${chalk.yellow('/model help')} - Show this help message`);

                console.log(
                    chalk.dim('\n💡 Switching models allows you to use different AI capabilities')
                );
                console.log(chalk.dim('💡 Model changes apply to the current session immediately'));
                console.log(chalk.dim('💡 Available providers: openai, anthropic, gemini'));
                console.log(
                    chalk.dim('💡 You can also press Ctrl+M for interactive model selector\n')
                );

                return helpText;
            },
        },
    ],
    handler: async (args: string[], agent: DextoAgent): Promise<CommandHandlerResult> => {
        // Default to showing help about interactive selector if no subcommand
        if (args.length === 0) {
            const helpText = [
                '🤖 Model Selection',
                '\nIn interactive mode: Press Ctrl+M or type /model to show the model selector',
                '\nAdvanced subcommands (optional):',
                '  /model list    - List all available models',
                '  /model current - Show current model',
                '  /model switch <model> - Switch to specific model\n',
            ].join('\n');

            console.log(chalk.blue(helpText));
            return helpText;
        }

        const subcommand = args[0];
        const subArgs = args.slice(1);

        // Find matching subcommand
        const subcmd = modelCommands.subcommands?.find((s) => s.name === subcommand);
        if (subcmd) {
            return subcmd.handler(subArgs, agent);
        }

        const errorMsg = `❌ Unknown model subcommand: ${subcommand}\nUse /model for interactive selector or /model list to see all models`;
        console.log(chalk.red(errorMsg));
        return errorMsg;
    },
};
