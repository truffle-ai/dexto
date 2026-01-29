#!/usr/bin/env node
// Load environment variables FIRST with layered loading
import { applyLayeredEnvironmentLoading } from './utils/env.js';

// Apply layered environment loading before any other imports
await applyLayeredEnvironmentLoading();

import { existsSync, readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { Command } from 'commander';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { initAnalytics, capture, getWebUIAnalyticsConfig } from './analytics/index.js';
import { withAnalytics, safeExit, ExitSignal } from './analytics/wrapper.js';

// Use createRequire to import package.json without experimental warning
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

// Set CLI version for Dexto Gateway usage tracking
process.env.DEXTO_CLI_VERSION = pkg.version;

// Populate DEXTO_API_KEY for Dexto gateway routing
// Resolution order in getDextoApiKey():
//   1. Explicit env var (CI, testing, account override)
//   2. auth.json from `dexto login`
import { isDextoAuthEnabled } from '@dexto/agent-management';
if (isDextoAuthEnabled()) {
    const { getDextoApiKey } = await import('./cli/auth/index.js');
    const dextoApiKey = await getDextoApiKey();
    if (dextoApiKey) {
        process.env.DEXTO_API_KEY = dextoApiKey;
    }
}

import {
    logger,
    DextoLogger,
    FileTransport,
    DextoLogComponent,
    getProviderFromModel,
    getAllSupportedModels,
    startLlmRegistryAutoUpdate,
    DextoAgent,
    type LLMProvider,
    isPath,
    resolveApiKeyForProvider,
    getPrimaryApiKeyEnvVar,
} from '@dexto/core';
import {
    resolveAgentPath,
    loadAgentConfig,
    globalPreferencesExist,
    loadGlobalPreferences,
    resolveBundledScript,
    getDextoPath,
} from '@dexto/agent-management';
import type { ValidatedAgentConfig } from '@dexto/core';
import { startHonoApiServer } from './api/server-hono.js';
import { validateCliOptions, handleCliOptionsError } from './cli/utils/options.js';
import { validateAgentConfig } from './cli/utils/config-validation.js';
import { applyCLIOverrides, applyUserPreferences } from './config/cli-overrides.js';
import { enrichAgentConfig } from '@dexto/agent-management';
import { getPort } from './utils/port-utils.js';
import {
    createDextoProject,
    type CreateAppOptions,
    createImage,
    getUserInputToInitDextoApp,
    initDexto,
    postInitDexto,
} from './cli/commands/index.js';
import {
    handleSetupCommand,
    type CLISetupOptionsInput,
    handleInstallCommand,
    type InstallCommandOptions,
    handleUninstallCommand,
    type UninstallCommandOptions,
    handleListAgentsCommand,
    type ListAgentsCommandOptionsInput,
    handleWhichCommand,
    handleSyncAgentsCommand,
    shouldPromptForSync,
    markSyncDismissed,
    clearSyncDismissed,
    type SyncAgentsCommandOptions,
    handleLoginCommand,
    handleLogoutCommand,
    handleStatusCommand,
    handleBillingStatusCommand,
    handlePluginListCommand,
    handlePluginInstallCommand,
    handlePluginUninstallCommand,
    handlePluginValidateCommand,
    // Marketplace handlers
    handleMarketplaceAddCommand,
    handleMarketplaceRemoveCommand,
    handleMarketplaceUpdateCommand,
    handleMarketplaceListCommand,
    handleMarketplacePluginsCommand,
    handleMarketplaceInstallCommand,
    type PluginListCommandOptionsInput,
    type PluginInstallCommandOptionsInput,
    type MarketplaceListCommandOptionsInput,
    type MarketplaceInstallCommandOptionsInput,
} from './cli/commands/index.js';
import {
    handleSessionListCommand,
    handleSessionHistoryCommand,
    handleSessionDeleteCommand,
    handleSessionSearchCommand,
} from './cli/commands/session-commands.js';
import { requiresSetup } from './cli/utils/setup-utils.js';
import { checkForFileInCurrentDirectory, FileNotFoundError } from './cli/utils/package-mgmt.js';
import { checkForUpdates, displayUpdateNotification } from './cli/utils/version-check.js';
import { resolveWebRoot } from './web.js';
import { initializeMcpServer, createMcpTransport } from '@dexto/server';
import { createAgentCard } from '@dexto/core';
import { initializeMcpToolAggregationServer } from './api/mcp/tool-aggregation-handler.js';
import { CLIConfigOverrides } from './config/cli-overrides.js';

const program = new Command();

// Initialize analytics early (no-op if disabled)
await initAnalytics({ appVersion: pkg.version });

// Start version check early (non-blocking)
// We'll check the result later and display notification for interactive modes
const versionCheckPromise = checkForUpdates(pkg.version);

// Start self-updating LLM registry refresh (models.dev + OpenRouter mapping).
// Uses a cached snapshot on disk and refreshes in the background.
startLlmRegistryAutoUpdate();

/**
 * Recursively removes null values from an object.
 * This handles YAML files that have explicit `apiKey: null` entries
 * which would otherwise cause "Expected string, received null" validation errors.
 */
function cleanNullValues<T extends Record<string, unknown>>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
        return obj.map((item) =>
            typeof item === 'object' && item !== null
                ? cleanNullValues(item as Record<string, unknown>)
                : item
        ) as unknown as T;
    }

    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value === null) {
            // Skip null values - they become undefined (missing)
            continue;
        }
        if (typeof value === 'object' && !Array.isArray(value)) {
            cleaned[key] = cleanNullValues(value as Record<string, unknown>);
        } else if (Array.isArray(value)) {
            cleaned[key] = value.map((item) =>
                typeof item === 'object' && item !== null
                    ? cleanNullValues(item as Record<string, unknown>)
                    : item
            );
        } else {
            cleaned[key] = value;
        }
    }
    return cleaned as T;
}

// 1) GLOBAL OPTIONS
program
    .name('dexto')
    .description('AI-powered CLI and WebUI for interacting with MCP servers.')
    .version(pkg.version, '-v, --version', 'output the current version')
    .option('-a, --agent <id|path>', 'Agent ID or path to agent config file')
    .option(
        '-p, --prompt <text>',
        'Run prompt and exit. Alternatively provide a single quoted string as positional argument.'
    )
    .option('-s, --strict', 'Require all server connections to succeed')
    .option('--no-verbose', 'Disable verbose output')
    .option('--no-interactive', 'Disable interactive prompts and API key setup')
    .option('--skip-setup', 'Skip global setup validation (useful for MCP mode, automation)')
    .option('-m, --model <model>', 'Specify the LLM model to use')
    .option('--auto-approve', 'Always approve tool executions without confirmation prompts')
    .option('--no-elicitation', 'Disable elicitation (agent cannot prompt user for input)')
    .option('-c, --continue', 'Continue most recent session (requires -p/prompt)')
    .option('-r, --resume <sessionId>', 'Resume specific session (requires -p/prompt)')
    .option(
        '--mode <mode>',
        'The application in which dexto should talk to you - web | cli | server | mcp',
        'web'
    )
    .option('--port <port>', 'port for the server (default: 3000 for web, 3001 for server mode)')
    .option('--no-auto-install', 'Disable automatic installation of missing agents from registry')
    .option(
        '--image <package>',
        'Image package to load (e.g., @dexto/image-local). Overrides config image field.'
    )
    .option(
        '--dev',
        '[maintainers] Use local ./agents instead of ~/.dexto (for dexto repo development)'
    )
    .enablePositionalOptions();

// 2) `create-app` SUB-COMMAND
program
    .command('create-app [name]')
    .description('Create a Dexto application (CLI, web, bot, etc.)')
    .option('--from-image <package>', 'Use existing image (e.g., @dexto/image-local)')
    .option('--extend-image <package>', 'Extend image with custom providers')
    .option('--from-core', 'Build from @dexto/core (advanced)')
    .option('--type <type>', 'App type: script, webapp (default: script)')
    .action(
        withAnalytics('create-app', async (name?: string, options?: CreateAppOptions) => {
            try {
                p.intro(chalk.inverse('Create Dexto App'));

                // Create the app project structure (fully self-contained)
                await createDextoProject(name, options);

                p.outro(chalk.greenBright('Dexto app created successfully!'));
                safeExit('create-app', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto create-app command failed: ${err}`);
                safeExit('create-app', 1, 'error');
            }
        })
    );

// 3) `create-image` SUB-COMMAND
program
    .command('create-image [name]')
    .description('Create a Dexto image - a distributable agent harness package')
    .action(
        withAnalytics('create-image', async (name?: string) => {
            try {
                p.intro(chalk.inverse('Create Dexto Image'));

                // Create the image project structure
                const projectPath = await createImage(name);

                p.outro(chalk.greenBright(`Dexto image created successfully at ${projectPath}!`));
                safeExit('create-image', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto create-image command failed: ${err}`);
                safeExit('create-image', 1, 'error');
            }
        })
    );

// 4) `init-app` SUB-COMMAND
program
    .command('init-app')
    .description('Initialize an existing Typescript app with Dexto')
    .action(
        withAnalytics('init-app', async () => {
            try {
                // pre-condition: check that package.json and tsconfig.json exist in current directory to know that project is valid
                await checkForFileInCurrentDirectory('package.json');
                await checkForFileInCurrentDirectory('tsconfig.json');

                // start intro
                p.intro(chalk.inverse('Dexto Init App'));
                const userInput = await getUserInputToInitDextoApp();
                try {
                    capture('dexto_init', {
                        provider: userInput.llmProvider,
                        providedKey: Boolean(userInput.llmApiKey),
                    });
                } catch {
                    // Analytics failures should not block CLI execution.
                }
                await initDexto(
                    userInput.directory,
                    userInput.createExampleFile,
                    userInput.llmProvider,
                    userInput.llmApiKey
                );
                p.outro(chalk.greenBright('Dexto app initialized successfully!'));

                // add notes for users to get started with their new initialized Dexto project
                await postInitDexto(userInput.directory);
                safeExit('init-app', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                // if the package.json or tsconfig.json is not found, we give instructions to create a new project
                if (err instanceof FileNotFoundError) {
                    console.error(`❌ ${err.message} Run "dexto create-app" to create a new app`);
                    safeExit('init-app', 1, 'file-not-found');
                }
                console.error(`❌ Initialization failed: ${err}`);
                safeExit('init-app', 1, 'error');
            }
        })
    );

// 5) `setup` SUB-COMMAND
program
    .command('setup')
    .description('Configure global Dexto preferences')
    .option('--provider <provider>', 'LLM provider (openai, anthropic, google, groq)')
    .option('--model <model>', 'Model name (uses provider default if not specified)')
    .option('--default-agent <agent>', 'Default agent name (default: coding-agent)')
    .option('--no-interactive', 'Skip interactive prompts and API key setup')
    .option('--force', 'Overwrite existing setup without confirmation')
    .action(
        withAnalytics('setup', async (options: CLISetupOptionsInput) => {
            try {
                await handleSetupCommand(options);
                safeExit('setup', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(
                    `❌ dexto setup command failed: ${err}. Check logs in ~/.dexto/logs/dexto.log for more information`
                );
                safeExit('setup', 1, 'error');
            }
        })
    );

// 6) `install` SUB-COMMAND
program
    .command('install [agents...]')
    .description('Install agents from registry or custom YAML files/directories')
    .option('--all', 'Install all available agents from registry')
    .option('--no-inject-preferences', 'Skip injecting global preferences into installed agents')
    .option('--force', 'Force reinstall even if agent is already installed')
    .addHelpText(
        'after',
        `
Examples:
  $ dexto install coding-agent               Install agent from registry
  $ dexto install agent1 agent2              Install multiple registry agents
  $ dexto install --all                      Install all available registry agents
  $ dexto install ./my-agent.yml             Install custom agent from YAML file
  $ dexto install ./my-agent-dir/            Install custom agent from directory (interactive)`
    )
    .action(
        withAnalytics(
            'install',
            async (agents: string[] = [], options: Partial<InstallCommandOptions>) => {
                try {
                    await handleInstallCommand(agents, options);
                    safeExit('install', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto install command failed: ${err}`);
                    safeExit('install', 1, 'error');
                }
            }
        )
    );

// 7) `uninstall` SUB-COMMAND
program
    .command('uninstall [agents...]')
    .description('Uninstall agents from the local installation')
    .option('--all', 'Uninstall all installed agents')
    .option('--force', 'Force uninstall even if agent is protected (e.g., coding-agent)')
    .action(
        withAnalytics(
            'uninstall',
            async (agents: string[], options: Partial<UninstallCommandOptions>) => {
                try {
                    await handleUninstallCommand(agents, options);
                    safeExit('uninstall', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto uninstall command failed: ${err}`);
                    safeExit('uninstall', 1, 'error');
                }
            }
        )
    );

// 8) `list-agents` SUB-COMMAND
program
    .command('list-agents')
    .description('List available and installed agents')
    .option('--verbose', 'Show detailed agent information')
    .option('--installed', 'Show only installed agents')
    .option('--available', 'Show only available agents')
    .action(
        withAnalytics('list-agents', async (options: ListAgentsCommandOptionsInput) => {
            try {
                await handleListAgentsCommand(options);
                safeExit('list-agents', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto list-agents command failed: ${err}`);
                safeExit('list-agents', 1, 'error');
            }
        })
    );

// 9) `which` SUB-COMMAND
program
    .command('which <agent>')
    .description('Show the path to an agent')
    .action(
        withAnalytics('which', async (agent: string) => {
            try {
                await handleWhichCommand(agent);
                safeExit('which', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto which command failed: ${err}`);
                safeExit('which', 1, 'error');
            }
        })
    );

// 10) `sync-agents` SUB-COMMAND
program
    .command('sync-agents')
    .description('Sync installed agents with bundled versions')
    .option('--list', 'List agent status without updating')
    .option('--force', 'Update all agents without prompting')
    .action(
        withAnalytics('sync-agents', async (options: Partial<SyncAgentsCommandOptions>) => {
            try {
                await handleSyncAgentsCommand(options);
                safeExit('sync-agents', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto sync-agents command failed: ${err}`);
                safeExit('sync-agents', 1, 'error');
            }
        })
    );

// 11) `plugin` SUB-COMMAND
const pluginCommand = program.command('plugin').description('Manage plugins');

pluginCommand
    .command('list')
    .description('List installed plugins')
    .option('--verbose', 'Show detailed plugin information')
    .action(
        withAnalytics('plugin list', async (options: PluginListCommandOptionsInput) => {
            try {
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
                await handlePluginValidateCommand({ path: path || '.' });
                safeExit('plugin validate', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto plugin validate command failed: ${err}`);
                safeExit('plugin validate', 1, 'error');
            }
        })
    );

// 12) `plugin marketplace` SUB-COMMANDS
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

// Helper to bootstrap a minimal agent for non-interactive session/search ops
async function bootstrapAgentFromGlobalOpts() {
    const globalOpts = program.opts();
    const resolvedPath = await resolveAgentPath(globalOpts.agent, globalOpts.autoInstall !== false);
    const rawConfig = await loadAgentConfig(resolvedPath);
    const mergedConfig = applyCLIOverrides(rawConfig, globalOpts);

    // Load image first to get bundled plugins
    // Priority: CLI flag > Agent config > Environment variable > Default
    const imageName =
        globalOpts.image || // --image flag
        mergedConfig.image || // image field in agent config
        process.env.DEXTO_IMAGE || // DEXTO_IMAGE env var
        '@dexto/image-local'; // Default for convenience

    let imageMetadata: { bundledPlugins?: string[] } | null = null;
    try {
        const imageModule = await import(imageName);
        imageMetadata = imageModule.imageMetadata || null;
    } catch (_err) {
        console.error(`❌ Failed to load image '${imageName}'`);
        console.error(
            `💡 Install it with: ${
                existsSync('package.json') ? 'npm install' : 'npm install -g'
            } ${imageName}`
        );
        safeExit('bootstrap', 1, 'image-load-failed');
    }

    // Enrich config with bundled plugins from image
    const enrichedConfig = enrichAgentConfig(mergedConfig, resolvedPath, {
        logLevel: 'info', // CLI uses info-level logging for visibility
        bundledPlugins: imageMetadata?.bundledPlugins || [],
    });

    // Override approval config for read-only commands (never run conversations)
    // This avoids needing to set up unused approval handlers
    enrichedConfig.toolConfirmation = {
        mode: 'auto-approve',
        ...(enrichedConfig.toolConfirmation?.timeout !== undefined && {
            timeout: enrichedConfig.toolConfirmation.timeout,
        }),
    };
    enrichedConfig.elicitation = {
        enabled: false,
        ...(enrichedConfig.elicitation?.timeout !== undefined && {
            timeout: enrichedConfig.elicitation.timeout,
        }),
    };

    // Use relaxed validation for session commands - they don't need LLM calls
    const agent = new DextoAgent(enrichedConfig, resolvedPath, { strict: false });
    await agent.start();

    // Register graceful shutdown
    const shutdown = async () => {
        try {
            await agent.stop();
        } catch (_err) {
            // Ignore shutdown errors
        }
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    return agent;
}

// Helper to find the most recent session
// @param includeHeadless - If false, skip ephemeral headless sessions (for interactive mode)
//                          If true, include all sessions (for headless mode continuation)
async function getMostRecentSessionId(
    agent: DextoAgent,
    includeHeadless: boolean = false
): Promise<string | null> {
    const sessionIds = await agent.listSessions();
    if (sessionIds.length === 0) {
        return null;
    }

    // Get metadata for all sessions to find most recent
    let mostRecentId: string | null = null;
    let mostRecentActivity = 0;

    for (const sessionId of sessionIds) {
        // Skip ephemeral headless sessions unless includeHeadless is true
        if (!includeHeadless && sessionId.startsWith('headless-')) {
            continue;
        }

        const metadata = await agent.getSessionMetadata(sessionId);
        if (metadata && metadata.lastActivity > mostRecentActivity) {
            mostRecentActivity = metadata.lastActivity;
            mostRecentId = sessionId;
        }
    }

    return mostRecentId;
}

// 11) `session` SUB-COMMAND
const sessionCommand = program.command('session').description('Manage chat sessions');

sessionCommand
    .command('list')
    .description('List all sessions')
    .action(
        withAnalytics('session list', async () => {
            try {
                const agent = await bootstrapAgentFromGlobalOpts();

                await handleSessionListCommand(agent);
                await agent.stop();
                safeExit('session list', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto session list command failed: ${err}`);
                safeExit('session list', 1, 'error');
            }
        })
    );

sessionCommand
    .command('history')
    .description('Show session history')
    .argument('[sessionId]', 'Session ID (defaults to current session)')
    .action(
        withAnalytics('session history', async (sessionId: string) => {
            try {
                const agent = await bootstrapAgentFromGlobalOpts();

                await handleSessionHistoryCommand(agent, sessionId);
                await agent.stop();
                safeExit('session history', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto session history command failed: ${err}`);
                safeExit('session history', 1, 'error');
            }
        })
    );

sessionCommand
    .command('delete')
    .description('Delete a session')
    .argument('<sessionId>', 'Session ID to delete')
    .action(
        withAnalytics('session delete', async (sessionId: string) => {
            try {
                const agent = await bootstrapAgentFromGlobalOpts();

                await handleSessionDeleteCommand(agent, sessionId);
                await agent.stop();
                safeExit('session delete', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto session delete command failed: ${err}`);
                safeExit('session delete', 1, 'error');
            }
        })
    );

// 12) `search` SUB-COMMAND
program
    .command('search')
    .description('Search session history')
    .argument('<query>', 'Search query')
    .option('--session <sessionId>', 'Search in specific session')
    .option('--role <role>', 'Filter by role (user, assistant, system, tool)')
    .option('--limit <number>', 'Limit number of results', '10')
    .action(
        withAnalytics(
            'search',
            async (query: string, options: { session?: string; role?: string; limit?: string }) => {
                try {
                    const agent = await bootstrapAgentFromGlobalOpts();

                    const searchOptions: {
                        sessionId?: string;
                        role?: 'user' | 'assistant' | 'system' | 'tool';
                        limit?: number;
                    } = {};

                    if (options.session) {
                        searchOptions.sessionId = options.session;
                    }
                    if (options.role) {
                        const allowed = new Set(['user', 'assistant', 'system', 'tool']);
                        if (!allowed.has(options.role)) {
                            console.error(
                                `❌ Invalid role: ${options.role}. Use one of: user, assistant, system, tool`
                            );
                            safeExit('search', 1, 'invalid-role');
                        }
                        searchOptions.role = options.role as
                            | 'user'
                            | 'assistant'
                            | 'system'
                            | 'tool';
                    }
                    if (options.limit) {
                        const parsed = parseInt(options.limit, 10);
                        if (Number.isNaN(parsed) || parsed <= 0) {
                            console.error(
                                `❌ Invalid --limit: ${options.limit}. Use a positive integer (e.g., 10).`
                            );
                            safeExit('search', 1, 'invalid-limit');
                        }
                        searchOptions.limit = parsed;
                    }

                    await handleSessionSearchCommand(agent, query, searchOptions);
                    await agent.stop();
                    safeExit('search', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto search command failed: ${err}`);
                    safeExit('search', 1, 'error');
                }
            }
        )
    );

// 13) `auth` SUB-COMMAND GROUP
const authCommand = program.command('auth').description('Manage authentication');

authCommand
    .command('login')
    .description('Login to Dexto')
    .option('--api-key <key>', 'Use Dexto API key instead of browser login')
    .option('--no-interactive', 'Disable interactive prompts')
    .action(
        withAnalytics('auth login', async (options: { apiKey?: string; interactive?: boolean }) => {
            try {
                await handleLoginCommand(options);
                safeExit('auth login', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto auth login command failed: ${err}`);
                safeExit('auth login', 1, 'error');
            }
        })
    );

authCommand
    .command('logout')
    .description('Logout from Dexto')
    .option('--force', 'Skip confirmation prompt')
    .option('--no-interactive', 'Disable interactive prompts')
    .action(
        withAnalytics(
            'auth logout',
            async (options: { force?: boolean; interactive?: boolean }) => {
                try {
                    await handleLogoutCommand(options);
                    safeExit('auth logout', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto auth logout command failed: ${err}`);
                    safeExit('auth logout', 1, 'error');
                }
            }
        )
    );

authCommand
    .command('status')
    .description('Show authentication status')
    .action(
        withAnalytics('auth status', async () => {
            try {
                await handleStatusCommand();
                safeExit('auth status', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto auth status command failed: ${err}`);
                safeExit('auth status', 1, 'error');
            }
        })
    );

// Also add convenience aliases at root level
program
    .command('login')
    .description('Login to Dexto (alias for `dexto auth login`)')
    .option('--api-key <key>', 'Use Dexto API key instead of browser login')
    .option('--no-interactive', 'Disable interactive prompts')
    .action(
        withAnalytics('login', async (options: { apiKey?: string; interactive?: boolean }) => {
            try {
                await handleLoginCommand(options);
                safeExit('login', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto login command failed: ${err}`);
                safeExit('login', 1, 'error');
            }
        })
    );

program
    .command('logout')
    .description('Logout from Dexto (alias for `dexto auth logout`)')
    .option('--force', 'Skip confirmation prompt')
    .option('--no-interactive', 'Disable interactive prompts')
    .action(
        withAnalytics('logout', async (options: { force?: boolean; interactive?: boolean }) => {
            try {
                await handleLogoutCommand(options);
                safeExit('logout', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto logout command failed: ${err}`);
                safeExit('logout', 1, 'error');
            }
        })
    );

// 14) `billing` COMMAND
program
    .command('billing')
    .description('Show billing status and credit balance')
    .action(
        withAnalytics('billing', async () => {
            try {
                await handleBillingStatusCommand();
                safeExit('billing', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto billing command failed: ${err}`);
                safeExit('billing', 1, 'error');
            }
        })
    );

// 15) `mcp` SUB-COMMAND
// For now, this mode simply aggregates and re-expose tools from configured MCP servers (no agent)
// dexto --mode mcp will be moved to this sub-command in the future
program
    .command('mcp')
    .description(
        'Start Dexto as an MCP server. Use --group-servers to aggregate and re-expose tools from configured MCP servers. \
        In the future, this command will expose the agent as an MCP server by default.'
    )
    .option('-s, --strict', 'Require all MCP server connections to succeed')
    .option(
        '--group-servers',
        'Aggregate and re-expose tools from configured MCP servers (required for now)'
    )
    .option('--name <n>', 'Name for the MCP server', 'dexto-tools')
    .option('--version <version>', 'Version for the MCP server', '1.0.0')
    .action(
        withAnalytics(
            'mcp',
            async (options) => {
                try {
                    // Validate that --group-servers flag is provided (mandatory for now)
                    if (!options.groupServers) {
                        console.error(
                            '❌ The --group-servers flag is required. This command currently only supports aggregating and re-exposing tools from configured MCP servers.'
                        );
                        console.error('Usage: dexto mcp --group-servers');
                        safeExit('mcp', 1, 'missing-group-servers');
                    }

                    // Load and resolve config
                    // Get the global agent option from the main program
                    const globalOpts = program.opts();
                    const nameOrPath = globalOpts.agent;

                    const configPath = await resolveAgentPath(
                        nameOrPath,
                        globalOpts.autoInstall !== false
                    );
                    console.log(`📄 Loading Dexto config from: ${configPath}`);
                    const config = await loadAgentConfig(configPath);

                    logger.info(`Validating MCP servers...`);
                    // Validate that MCP servers are configured
                    if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
                        console.error(
                            '❌ No MCP servers configured. Please configure mcpServers in your config file.'
                        );
                        safeExit('mcp', 1, 'no-mcp-servers');
                    }

                    const { ServerConfigsSchema } = await import('@dexto/core');
                    const validatedServers = ServerConfigsSchema.parse(config.mcpServers);
                    logger.info(
                        `Validated MCP servers. Configured servers: ${Object.keys(validatedServers).join(', ')}`
                    );

                    // Logs are already redirected to file by default to prevent interference with stdio transport
                    const currentLogPath = logger.getLogFilePath();
                    logger.info(
                        `MCP mode using log file: ${currentLogPath || 'default .dexto location'}`
                    );

                    logger.info(
                        `Starting MCP tool aggregation server: ${options.name} v${options.version}`
                    );

                    // Create stdio transport for MCP tool aggregation
                    const mcpTransport = await createMcpTransport('stdio');
                    // Initialize tool aggregation server
                    await initializeMcpToolAggregationServer(
                        validatedServers,
                        mcpTransport,
                        options.name,
                        options.version,
                        options.strict
                    );

                    logger.info('MCP tool aggregation server started successfully');
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    // Write to stderr to avoid interfering with MCP protocol
                    process.stderr.write(`MCP tool aggregation server startup failed: ${err}\n`);
                    safeExit('mcp', 1, 'mcp-agg-failed');
                }
            },
            { timeoutMs: 0 }
        )
    );

// 16) Main dexto CLI - Interactive/One shot (CLI/HEADLESS) or run in other modes (--mode web/server/mcp)
program
    .argument(
        '[prompt...]',
        'Natural-language prompt to run once. If not passed, dexto will start as an interactive CLI'
    )
    // Main customer facing description
    .description(
        'Dexto CLI - AI-powered assistant with session management.\n\n' +
            'Basic Usage:\n' +
            '  dexto                    Start web UI (default)\n' +
            '  dexto "query"            Run one-shot query (auto-uses CLI mode)\n' +
            '  dexto -p "query"         Run one-shot query, then exit\n' +
            '  cat file | dexto -p "query"  Process piped content\n\n' +
            'CLI Mode:\n' +
            '  dexto --mode cli         Start interactive CLI\n\n' +
            'Headless Session Continuation:\n' +
            '  dexto -c -p "message"           Continue most recent session\n' +
            '  dexto -r <session-id> -p "msg"  Resume specific session by ID\n' +
            '  (Interactive mode: use /resume command instead)\n\n' +
            'Session Management Commands:\n' +
            '  dexto session list              List all sessions\n' +
            '  dexto session history [id]      Show session history\n' +
            '  dexto session delete <id>       Delete a session\n' +
            '  dexto search <query>            Search across sessions\n' +
            '    Options: --session <id>, --role <user|assistant>, --limit <n>\n\n' +
            'Agent Selection:\n' +
            '  dexto --agent coding-agent       Use installed agent by name\n' +
            '  dexto --agent ./my-agent.yml     Use agent from file path\n' +
            '  dexto -a agents/custom.yml       Short form with relative path\n\n' +
            'Tool Confirmation:\n' +
            '  dexto --auto-approve     Auto-approve all tool executions\n\n' +
            'Advanced Modes:\n' +
            '  dexto --mode server      Run as API server\n' +
            '  dexto --mode mcp         Run as MCP server\n\n' +
            'See https://docs.dexto.ai for documentation and examples'
    )
    .action(
        withAnalytics(
            'main',
            async (prompt: string[] = []) => {
                // ——— ENV CHECK (optional) ———
                if (!existsSync('.env')) {
                    logger.debug(
                        'WARNING: .env file not found; copy .env.example and set your API keys.'
                    );
                }

                const opts = program.opts();

                // Set dev mode early to use local repo agents instead of ~/.dexto
                if (opts.dev) {
                    process.env.DEXTO_DEV_MODE = 'true';
                }

                // ——— LOAD DEFAULT MODE FROM PREFERENCES ———
                // If --mode was not explicitly provided on CLI, use defaultMode from preferences
                const modeSource = program.getOptionValueSource('mode');
                const explicitModeProvided = modeSource === 'cli';
                if (!explicitModeProvided) {
                    try {
                        if (globalPreferencesExist()) {
                            const preferences = await loadGlobalPreferences();
                            if (preferences.defaults?.defaultMode) {
                                opts.mode = preferences.defaults.defaultMode;
                                logger.debug(`Using default mode from preferences: ${opts.mode}`);
                            }
                        }
                    } catch (error) {
                        // Silently fall back to hardcoded default if preferences loading fails
                        logger.debug(
                            `Failed to load default mode from preferences: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }

                let headlessInput: string | undefined = undefined;

                // Prefer explicit -p/--prompt for headless one-shot
                if (opts.prompt !== undefined && String(opts.prompt).trim() !== '') {
                    headlessInput = String(opts.prompt);
                } else if (opts.prompt !== undefined) {
                    // Explicit empty -p "" was provided
                    console.error(
                        '❌ For headless one-shot mode, prompt cannot be empty. Provide a non-empty prompt with -p/--prompt or use positional argument.'
                    );
                    safeExit('main', 1, 'empty-prompt');
                } else if (prompt.length > 0) {
                    // Enforce quoted single positional argument for headless mode
                    if (prompt.length === 1) {
                        headlessInput = prompt[0];
                    } else {
                        console.error(
                            '❌ For headless one-shot mode, pass the prompt in double quotes as a single argument (e.g., "say hello") or use -p/--prompt.'
                        );
                        safeExit('main', 1, 'too-many-positional');
                    }
                }

                // Note: Agent selection must be passed via -a/--agent. We no longer interpret
                // the first positional argument as an agent name to avoid ambiguity with prompts.

                // ——— VALIDATE SESSION FLAGS ———
                // -c and -r are for headless mode only (require a prompt)
                if ((opts.continue || opts.resume) && !headlessInput) {
                    console.error(
                        '❌ Session continuation flags (-c/--continue or -r/--resume) require a prompt for headless mode.'
                    );
                    console.error(
                        '   Provide a prompt: dexto -c -p "your message" or dexto -r <sessionId> -p "your message"'
                    );
                    console.error(
                        '   For interactive mode with session management, use: dexto (starts new) or use /resume command'
                    );
                    safeExit('main', 1, 'session-flag-without-prompt');
                }

                // ——— FORCE CLI MODE FOR HEADLESS PROMPTS ———
                // If a prompt was provided via -p or positional args, force CLI mode
                if (headlessInput && opts.mode !== 'cli') {
                    console.error(
                        `ℹ️  Prompt detected via -p or positional argument. Forcing CLI mode for one-shot execution.`
                    );
                    console.error(`   Original mode: ${opts.mode} → Overridden to: cli`);
                    opts.mode = 'cli';
                }

                // ——— Infer provider & API key from model ———
                if (opts.model) {
                    if (opts.model.includes('/')) {
                        console.error(
                            `❌ Model '${opts.model}' looks like an OpenRouter-format ID (provider/model).`
                        );
                        console.error(
                            `   This is ambiguous for --model inference. Please also pass --provider (e.g. --provider dexto or --provider openrouter).`
                        );
                        safeExit('main', 1, 'ambiguous-model');
                    }

                    let provider: LLMProvider;
                    try {
                        provider = getProviderFromModel(opts.model);
                    } catch (err) {
                        console.error(`❌ ${(err as Error).message}`);
                        console.error(`Supported models: ${getAllSupportedModels().join(', ')}`);
                        safeExit('main', 1, 'invalid-model');
                    }

                    const apiKey = resolveApiKeyForProvider(provider);
                    if (!apiKey) {
                        const envVar = getPrimaryApiKeyEnvVar(provider);
                        console.error(
                            `❌ Missing API key for provider '${provider}' - please set $${envVar}`
                        );
                        safeExit('main', 1, 'missing-api-key');
                    }
                    opts.provider = provider;
                    opts.apiKey = apiKey;
                }

                try {
                    validateCliOptions(opts);
                } catch (err) {
                    handleCliOptionsError(err);
                }

                // ——— ENHANCED PREFERENCE-AWARE CONFIG LOADING ———
                let validatedConfig: ValidatedAgentConfig;
                let resolvedPath: string;

                // Determine validation mode early - used throughout config loading and agent creation
                // Use relaxed validation for interactive modes (web/cli) where users can configure later
                // Use strict validation for headless modes (server/mcp) that need full config upfront
                const isInteractiveMode = opts.mode === 'web' || opts.mode === 'cli';

                try {
                    // Case 1: File path - skip all validation and setup
                    if (opts.agent && isPath(opts.agent)) {
                        resolvedPath = await resolveAgentPath(
                            opts.agent,
                            opts.autoInstall !== false
                        );
                    }
                    // Cases 2 & 3: Default agent or registry agent
                    else {
                        // Early registry validation for named agents
                        if (opts.agent) {
                            // Load bundled registry to check if agent exists
                            try {
                                const bundledRegistryPath = resolveBundledScript(
                                    'agents/agent-registry.json'
                                );
                                const registryContent = readFileSync(bundledRegistryPath, 'utf-8');
                                const bundledRegistry = JSON.parse(registryContent);

                                // Check if agent exists in bundled registry
                                if (!(opts.agent in bundledRegistry.agents)) {
                                    console.error(`❌ Agent '${opts.agent}' not found in registry`);

                                    // Show available agents
                                    const available = Object.keys(bundledRegistry.agents);
                                    if (available.length > 0) {
                                        console.log(`📋 Available agents: ${available.join(', ')}`);
                                    } else {
                                        console.log('📋 No agents available in registry');
                                    }
                                    safeExit('main', 1, 'agent-not-in-registry');
                                    return;
                                }
                            } catch (error) {
                                logger.warn(
                                    `Could not validate agent against registry: ${error instanceof Error ? error.message : String(error)}`
                                );
                                // Continue anyway - resolver will handle it
                            }
                        }

                        // Check setup state and auto-trigger if needed
                        // Skip if --skip-setup flag is set (for MCP mode, automation, etc.)
                        if (!opts.skipSetup && (await requiresSetup())) {
                            if (opts.interactive === false) {
                                console.error(
                                    '❌ Setup required but --no-interactive flag is set.'
                                );
                                console.error(
                                    '💡 Run `dexto setup` first, or use --skip-setup to bypass global setup.'
                                );
                                safeExit('main', 1, 'setup-required-non-interactive');
                            }

                            await handleSetupCommand({ interactive: true });

                            // Reload preferences after setup to get the newly selected default mode
                            // (setup may have just saved a different mode than the default 'web')
                            try {
                                const newPreferences = await loadGlobalPreferences();
                                if (newPreferences.defaults?.defaultMode) {
                                    opts.mode = newPreferences.defaults.defaultMode;
                                    logger.debug(
                                        `Updated mode from setup preferences: ${opts.mode}`
                                    );
                                }
                            } catch {
                                // Ignore errors - will use default mode
                            }
                        }

                        // Now resolve agent (will auto-install since setup is complete)
                        resolvedPath = await resolveAgentPath(
                            opts.agent,
                            opts.autoInstall !== false
                        );
                    }

                    // Load raw config and apply CLI overrides
                    const rawConfig = await loadAgentConfig(resolvedPath);
                    let mergedConfig = applyCLIOverrides(rawConfig, opts as CLIConfigOverrides);

                    // ——— PREFERENCE-AWARE CONFIG HANDLING ———
                    // User's LLM preferences from preferences.yml apply to ALL agents
                    // See feature-plans/auto-update.md section 8.11 - Three-Layer LLM Resolution
                    const agentId = opts.agent ?? 'coding-agent';
                    let preferences: Awaited<ReturnType<typeof loadGlobalPreferences>> | null =
                        null;

                    if (globalPreferencesExist()) {
                        try {
                            preferences = await loadGlobalPreferences();
                        } catch {
                            // Preferences exist but couldn't load - continue without them
                            logger.debug('Could not load preferences, continuing without them');
                        }
                    }

                    // Check if user is configured for Dexto credits but not authenticated
                    // This can happen if user logged out after setting up with Dexto
                    // Now that preferences apply to ALL agents, we check for any agent
                    // Only run this check when Dexto auth feature is enabled
                    if (isDextoAuthEnabled()) {
                        const { checkDextoAuthState } = await import(
                            './cli/utils/dexto-auth-check.js'
                        );
                        const authCheck = await checkDextoAuthState(
                            opts.interactive !== false,
                            agentId
                        );

                        if (!authCheck.shouldContinue) {
                            if (authCheck.action === 'login') {
                                // User wants to log in - run login flow then restart
                                const { handleLoginCommand } = await import(
                                    './cli/commands/auth/login.js'
                                );
                                await handleLoginCommand({ interactive: true });

                                // Verify key was actually provisioned (provisionKeys silently catches errors)
                                const { canUseDextoProvider } = await import(
                                    './cli/utils/dexto-setup.js'
                                );
                                if (!(await canUseDextoProvider())) {
                                    console.error(
                                        '\n❌ API key provisioning failed. Please try again or run `dexto setup` to use a different provider.\n'
                                    );
                                    safeExit('main', 1, 'dexto-key-provisioning-failed');
                                }
                                // After login, continue with startup (preferences unchanged, now authenticated)
                            } else if (authCheck.action === 'setup') {
                                // User wants to configure different provider - run setup
                                const { handleSetupCommand } = await import(
                                    './cli/commands/setup.js'
                                );
                                await handleSetupCommand({ interactive: true, force: true });
                                // Reload preferences after setup
                                preferences = await loadGlobalPreferences();
                            } else {
                                // User cancelled
                                safeExit('main', 0, 'dexto-auth-check-cancelled');
                            }
                        }
                    }

                    // Check for pending API key setup (user skipped during initial setup)
                    // Since preferences now apply to ALL agents, this check runs for any agent
                    if (preferences?.setup?.apiKeyPending && opts.interactive !== false) {
                        // Check if API key is still missing (user may have set it manually)
                        const configuredApiKey = resolveApiKeyForProvider(preferences.llm.provider);
                        if (!configuredApiKey) {
                            const { promptForPendingApiKey } = await import(
                                './cli/utils/api-key-setup.js'
                            );
                            const { updateGlobalPreferences } = await import(
                                '@dexto/agent-management'
                            );

                            const result = await promptForPendingApiKey(
                                preferences.llm.provider,
                                preferences.llm.model
                            );

                            if (result.action === 'cancel') {
                                safeExit('main', 0, 'pending-api-key-cancelled');
                            }

                            if (result.action === 'setup' && result.apiKey) {
                                // API key was configured - update preferences to clear pending flag
                                await updateGlobalPreferences({
                                    setup: { apiKeyPending: false },
                                });
                                // Update the merged config with the new API key
                                mergedConfig.llm.apiKey = result.apiKey;
                                logger.debug('API key configured, pending flag cleared');
                            }
                            // If 'skip', continue without API key (user chose to proceed)
                        } else {
                            // API key exists (user set it manually) - clear the pending flag
                            const { updateGlobalPreferences } = await import(
                                '@dexto/agent-management'
                            );
                            await updateGlobalPreferences({
                                setup: { apiKeyPending: false },
                            });
                            logger.debug('API key found in environment, cleared pending flag');
                        }
                    }

                    // Apply user's LLM preferences to ALL agents (not just the default)
                    // See feature-plans/auto-update.md section 8.11 - Three-Layer LLM Resolution:
                    //   local.llm ?? preferences.llm ?? bundled.llm
                    // The preferences.llm acts as a "global .local.yml" for LLM settings
                    if (preferences?.llm?.provider && preferences?.llm?.model) {
                        mergedConfig = applyUserPreferences(mergedConfig, preferences);
                        logger.debug(`Applied user preferences to ${agentId}`, {
                            provider: preferences.llm.provider,
                            model: preferences.llm.model,
                        });
                    }

                    // Clean up null values from config (can happen from YAML files with explicit nulls)
                    // This prevents "Expected string, received null" errors for optional fields
                    const cleanedConfig = cleanNullValues(mergedConfig);

                    // Load image first to get bundled plugins
                    // Priority: CLI flag > Agent config > Environment variable > Default
                    const imageNameForEnrichment =
                        opts.image || // --image flag
                        cleanedConfig.image || // image field in agent config
                        process.env.DEXTO_IMAGE || // DEXTO_IMAGE env var
                        '@dexto/image-local'; // Default for convenience

                    let imageMetadataForEnrichment: { bundledPlugins?: string[] } | null = null;
                    try {
                        const imageModule = await import(imageNameForEnrichment);
                        imageMetadataForEnrichment = imageModule.imageMetadata || null;
                        logger.debug(`Loaded image for enrichment: ${imageNameForEnrichment}`);
                    } catch (err) {
                        console.error(`❌ Failed to load image '${imageNameForEnrichment}'`);
                        if (err instanceof Error) {
                            logger.debug(`Image load error: ${err.message}`);
                        }
                        safeExit('main', 1, 'image-load-failed');
                    }

                    // Enrich config with per-agent paths and bundled plugins BEFORE validation
                    // Enrichment adds filesystem paths to storage (schema has in-memory defaults)
                    // Interactive CLI mode: only log to file (console would interfere with chat UI)
                    const isInteractiveCli = opts.mode === 'cli' && !headlessInput;
                    const enrichedConfig = enrichAgentConfig(cleanedConfig, resolvedPath, {
                        isInteractiveCli,
                        logLevel: 'info', // CLI uses info-level logging for visibility
                        bundledPlugins: imageMetadataForEnrichment?.bundledPlugins || [],
                    });

                    // Validate enriched config with interactive setup if needed (for API key issues)
                    // isInteractiveMode is defined above the try block
                    const validationResult = await validateAgentConfig(
                        enrichedConfig,
                        opts.interactive !== false,
                        { strict: !isInteractiveMode, agentPath: resolvedPath }
                    );

                    if (validationResult.success && validationResult.config) {
                        validatedConfig = validationResult.config;
                    } else if (validationResult.skipped) {
                        // User chose to continue despite validation errors
                        // SAFETY: This cast is intentionally unsafe - it's an escape hatch for users
                        // when validation is overly strict or incorrect. Runtime errors will surface
                        // if the config truly doesn't work. Future: explicit `allowUnvalidated` mode.
                        logger.warn(
                            'Starting with validation warnings - some features may not work'
                        );
                        validatedConfig = enrichedConfig as ValidatedAgentConfig;
                    } else {
                        // Validation failed and user didn't skip - show next steps and exit
                        safeExit('main', 1, 'config-validation-failed');
                    }

                    // Validate that if config specifies an image, it matches what was loaded
                    // Skip this check if user explicitly provided --image flag (intentional override)
                    // Note: Image was already loaded earlier before enrichment
                    if (
                        !opts.image &&
                        validatedConfig.image &&
                        validatedConfig.image !== imageNameForEnrichment
                    ) {
                        console.error(
                            `❌ Config specifies image '${validatedConfig.image}' but '${imageNameForEnrichment}' was loaded instead`
                        );
                        console.error(
                            `💡 Either remove 'image' from config or ensure it matches the loaded image`
                        );
                        safeExit('main', 1, 'image-mismatch');
                    }
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    // Config loading failed completely
                    console.error(`❌ Failed to load configuration: ${err}`);
                    safeExit('main', 1, 'config-load-failed');
                }

                // ——— VALIDATE APPROVAL MODE COMPATIBILITY ———
                // Check if approval handler is needed (manual mode OR elicitation enabled)
                const needsHandler =
                    validatedConfig.toolConfirmation?.mode === 'manual' ||
                    validatedConfig.elicitation.enabled;

                if (needsHandler) {
                    // Headless CLI cannot do interactive approval
                    if (opts.mode === 'cli' && headlessInput) {
                        console.error(
                            '❌ Manual approval and elicitation are not supported in headless CLI mode (pipes/scripts).'
                        );
                        console.error(
                            '💡 Use interactive CLI mode, or skip approvals by running `dexto --auto-approve` and disabling elicitation in your config.'
                        );
                        console.error(
                            '   - toolConfirmation.mode: auto-approve (or auto-deny for strict denial policies)'
                        );
                        console.error('   - elicitation.enabled: false');
                        safeExit('main', 1, 'approval-unsupported-headless');
                    }

                    // Only web, server, and interactive CLI support approval handlers
                    // TODO: Add approval support for other modes:
                    // - Discord: Could use Discord message buttons/reactions for approval UI
                    // - Telegram: Could use Telegram inline keyboards for approval prompts
                    // - MCP: Could implement callback-based approval mechanism in MCP protocol
                    const supportedModes = ['web', 'server', 'cli'];
                    if (!supportedModes.includes(opts.mode)) {
                        console.error(
                            `❌ Manual approval and elicitation are not supported in "${opts.mode}" mode.`
                        );
                        console.error(
                            `💡 These features require interactive UI and are only supported in: ${supportedModes.join(
                                ', '
                            )}`
                        );
                        console.error(
                            '💡 Run `dexto --auto-approve` or configure your agent to skip approvals when running headlessly.'
                        );
                        console.error(
                            '   toolConfirmation.mode: auto-approve (or auto-deny if you want to deny certain tools)'
                        );
                        console.error('   elicitation.enabled: false');
                        safeExit('main', 1, 'approval-unsupported-mode');
                    }
                }

                // ——— CREATE AGENT ———
                let agent: DextoAgent;
                let derivedAgentId: string;
                try {
                    // Set run mode for tool confirmation provider
                    process.env.DEXTO_RUN_MODE = opts.mode;

                    // Apply --strict flag to all server configs
                    if (opts.strict && validatedConfig.mcpServers) {
                        for (const [_serverName, serverConfig] of Object.entries(
                            validatedConfig.mcpServers
                        )) {
                            // All server config types have connectionMode field
                            serverConfig.connectionMode = 'strict';
                        }
                    }

                    // Config is already enriched and validated - ready for agent creation
                    // DextoAgent will parse/validate again (parse-twice pattern)
                    // isInteractiveMode is already defined above for validateAgentConfig
                    const sessionLoggerFactory: import('@dexto/core').SessionLoggerFactory = ({
                        baseLogger,
                        agentId,
                        sessionId,
                    }) => {
                        // Sanitize sessionId to prevent path traversal attacks
                        // Allow only alphanumeric, dots, hyphens, and underscores
                        const safeSessionId = sessionId.replace(/[^a-zA-Z0-9._-]/g, '_');
                        const logFilePath = getDextoPath(
                            'logs',
                            path.join(agentId, `${safeSessionId}.log`)
                        );

                        // Standalone per-session file logger.
                        return new DextoLogger({
                            level: baseLogger.getLevel(),
                            agentId,
                            sessionId,
                            component: DextoLogComponent.SESSION,
                            transports: [new FileTransport({ path: logFilePath })],
                        });
                    };

                    agent = new DextoAgent(validatedConfig, resolvedPath, {
                        strict: !isInteractiveMode,
                        sessionLoggerFactory,
                    });

                    // Start the agent (initialize async services)
                    // - web/server modes: initializeHonoApi will set approval handler and start the agent
                    // - cli mode: handles its own approval setup in the case block
                    // - other modes: start immediately (no approval support)
                    if (opts.mode !== 'web' && opts.mode !== 'server' && opts.mode !== 'cli') {
                        await agent.start();
                    }

                    // Derive a concise agent ID for display purposes (used by API/UI)
                    // Prefer agentCard.name, otherwise extract from filename
                    derivedAgentId =
                        validatedConfig.agentCard?.name ||
                        path.basename(resolvedPath, path.extname(resolvedPath));
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    // Ensure config errors are shown to user, not hidden in logs
                    console.error(`❌ Configuration Error: ${(err as Error).message}`);
                    safeExit('main', 1, 'config-error');
                }

                // ——— Dispatch based on --mode ———
                // TODO: Refactor mode-specific logic into separate handler files
                // This switch statement has grown large with nested if-else chains for each mode.
                // Consider breaking down into mode-specific handlers (e.g., cli/modes/cli.ts, cli/modes/web.ts)
                // to improve maintainability and reduce complexity in this entry point file.
                // See PR 450 comment: https://github.com/truffle-ai/dexto/pull/450#discussion_r2546242983
                switch (opts.mode) {
                    case 'cli': {
                        // Set up approval handler for interactive CLI if manual mode OR elicitation enabled
                        // Note: Headless CLI with manual mode is blocked by validation above
                        const needsHandler =
                            !headlessInput &&
                            (validatedConfig.toolConfirmation?.mode === 'manual' ||
                                validatedConfig.elicitation.enabled);

                        if (needsHandler) {
                            // CLI uses its own approval handler that works directly with AgentEventBus
                            // This avoids the indirection of ApprovalCoordinator (designed for HTTP flows)
                            const { createCLIApprovalHandler } = await import(
                                './cli/approval/index.js'
                            );
                            const handler = createCLIApprovalHandler(agent.agentEventBus);
                            agent.setApprovalHandler(handler);

                            logger.debug('CLI approval handler configured for Ink CLI');
                        }

                        // Start the agent now that approval handler is configured
                        await agent.start();

                        // Session management - CLI uses explicit sessionId like WebUI
                        // NOTE: Migrated from defaultSession pattern which will be deprecated in core
                        // We now pass sessionId explicitly to all agent methods (agent.run, agent.switchLLM, etc.)

                        // Note: CLI uses different implementations for interactive vs headless modes
                        // - Interactive: Ink CLI with full TUI
                        // - Headless: CLISubscriber (no TUI, works in pipes/scripts)

                        if (headlessInput) {
                            // Headless mode - isolated execution by default
                            // Each run gets a unique ephemeral session to avoid context bleeding between runs
                            // Use persistent session if explicitly resuming with -r or -c
                            let headlessSessionId: string;

                            if (opts.resume) {
                                // Resume specific session by ID
                                try {
                                    const session = await agent.getSession(opts.resume);
                                    if (!session) {
                                        console.error(`❌ Session '${opts.resume}' not found`);
                                        console.error(
                                            '💡 Use `dexto session list` to see available sessions'
                                        );
                                        safeExit('main', 1, 'resume-failed');
                                    }
                                    headlessSessionId = opts.resume;
                                    logger.info(
                                        `Resumed session: ${headlessSessionId}`,
                                        null,
                                        'cyan'
                                    );
                                } catch (err) {
                                    console.error(
                                        `❌ Failed to resume session '${opts.resume}': ${err instanceof Error ? err.message : String(err)}`
                                    );
                                    console.error(
                                        '💡 Use `dexto session list` to see available sessions'
                                    );
                                    safeExit('main', 1, 'resume-failed');
                                }
                            } else if (opts.continue) {
                                // Continue most recent conversation (include headless sessions in headless mode)
                                const mostRecentSessionId = await getMostRecentSessionId(
                                    agent,
                                    true
                                );
                                if (!mostRecentSessionId) {
                                    console.error(`❌ No previous sessions found`);
                                    console.error(
                                        '💡 Start a new conversation or use `dexto session list` to see available sessions'
                                    );
                                    safeExit('main', 1, 'no-sessions-found');
                                }
                                headlessSessionId = mostRecentSessionId;
                                logger.info(
                                    `Continuing most recent session: ${headlessSessionId}`,
                                    null,
                                    'cyan'
                                );
                            } else {
                                // TODO: Remove this workaround once defaultSession is deprecated in core
                                // Currently passing null/undefined to agent.run() falls back to defaultSession,
                                // causing context to bleed between headless runs. We create a unique ephemeral
                                // session ID to ensure each headless run is isolated.
                                // When defaultSession is removed, we can pass null here for truly stateless execution.
                                headlessSessionId = `headless-${Date.now()}-${Math.random().toString(36).substring(7)}`;
                                logger.debug(
                                    `Created ephemeral session for headless run: ${headlessSessionId}`
                                );
                            }
                            // Headless mode - use CLISubscriber for simple stdout output
                            const llm = agent.getCurrentLLMConfig();
                            capture('dexto_prompt', {
                                mode: 'headless',
                                provider: llm.provider,
                                model: llm.model,
                            });

                            const { CLISubscriber } = await import('./cli/cli-subscriber.js');
                            const cliSubscriber = new CLISubscriber();
                            cliSubscriber.subscribe(agent.agentEventBus);

                            try {
                                await cliSubscriber.runAndWait(
                                    agent,
                                    headlessInput,
                                    headlessSessionId
                                );
                                // Clean up before exit
                                cliSubscriber.cleanup();
                                try {
                                    await agent.stop();
                                } catch (stopError) {
                                    logger.debug(`Agent stop error (ignoring): ${stopError}`);
                                }
                                safeExit('main', 0);
                            } catch (error) {
                                // Rethrow ExitSignal - it's not an error, it's how safeExit works
                                if (error instanceof ExitSignal) throw error;

                                // Write to stderr for headless users/scripts
                                const errorMessage =
                                    error instanceof Error ? error.message : String(error);
                                console.error(`❌ Error in headless mode: ${errorMessage}`);
                                if (error instanceof Error && error.stack) {
                                    console.error(error.stack);
                                }

                                // Also log for diagnostics
                                logger.error(`Error in headless mode: ${errorMessage}`);

                                cliSubscriber.cleanup();
                                await agent.stop().catch(() => {}); // Best effort cleanup
                                safeExit('main', 1, 'headless-error');
                            }
                        } else {
                            // Interactive mode - session management handled via /resume command
                            // Note: -c and -r flags are validated to require a prompt (headless mode only)

                            // Check if API key is configured before trying to create session
                            // Session creation triggers LLM service init which requires API key
                            const llmConfig = agent.getCurrentLLMConfig();
                            const { requiresApiKey } = await import('@dexto/core');
                            if (requiresApiKey(llmConfig.provider) && !llmConfig.apiKey?.trim()) {
                                // Offer interactive API key setup instead of just exiting
                                const { interactiveApiKeySetup } = await import(
                                    './cli/utils/api-key-setup.js'
                                );

                                console.log(
                                    chalk.yellow(
                                        `\n⚠️  API key required for provider '${llmConfig.provider}'\n`
                                    )
                                );

                                const setupResult = await interactiveApiKeySetup(
                                    llmConfig.provider,
                                    {
                                        exitOnCancel: false,
                                        model: llmConfig.model,
                                    }
                                );

                                if (setupResult.cancelled) {
                                    await agent.stop().catch(() => {});
                                    safeExit('main', 0, 'api-key-setup-cancelled');
                                }

                                if (setupResult.skipped) {
                                    // User chose to skip - exit with instructions
                                    await agent.stop().catch(() => {});
                                    safeExit('main', 0, 'api-key-pending');
                                }

                                if (setupResult.success && setupResult.apiKey) {
                                    // API key was entered and saved - reload config and continue
                                    // Update the agent's LLM config with the new API key
                                    await agent.switchLLM({
                                        provider: llmConfig.provider,
                                        model: llmConfig.model,
                                        apiKey: setupResult.apiKey,
                                    });
                                    logger.info('API key configured successfully, continuing...');
                                }
                            }

                            // Create session eagerly so slash commands work immediately
                            const session = await agent.createSession();
                            const cliSessionId: string = session.id;

                            // Check for updates (will be shown in Ink header)
                            const cliUpdateInfo = await versionCheckPromise;

                            // Check if installed agents differ from bundled and prompt to sync
                            const needsSync = await shouldPromptForSync(pkg.version);
                            if (needsSync) {
                                const shouldSync = await p.confirm({
                                    message: 'Agent config updates available. Sync now?',
                                    initialValue: true,
                                });

                                if (p.isCancel(shouldSync) || !shouldSync) {
                                    await markSyncDismissed(pkg.version);
                                } else {
                                    await handleSyncAgentsCommand({ force: true, quiet: true });
                                    await clearSyncDismissed();
                                }
                            }

                            // Interactive mode - use Ink CLI with session support
                            // Suppress console output before starting Ink UI
                            const originalConsole = {
                                log: console.log,
                                error: console.error,
                                warn: console.warn,
                                info: console.info,
                            };
                            const noOp = () => {};
                            console.log = noOp;
                            console.error = noOp;
                            console.warn = noOp;
                            console.info = noOp;

                            let inkError: unknown = undefined;
                            try {
                                const { startInkCliRefactored } = await import(
                                    './cli/ink-cli/InkCLIRefactored.js'
                                );
                                await startInkCliRefactored(agent, cliSessionId, {
                                    updateInfo: cliUpdateInfo ?? undefined,
                                });
                            } catch (error) {
                                inkError = error;
                            } finally {
                                // Restore console methods so any errors are visible
                                console.log = originalConsole.log;
                                console.error = originalConsole.error;
                                console.warn = originalConsole.warn;
                                console.info = originalConsole.info;
                            }

                            // Stop the agent after Ink CLI exits
                            try {
                                await agent.stop();
                            } catch {
                                // Ignore shutdown errors
                            }

                            // Handle any errors from Ink CLI
                            if (inkError) {
                                if (inkError instanceof ExitSignal) throw inkError;
                                const errorMessage =
                                    inkError instanceof Error ? inkError.message : String(inkError);
                                console.error(`❌ Ink CLI failed: ${errorMessage}`);
                                if (inkError instanceof Error && inkError.stack) {
                                    console.error(inkError.stack);
                                }
                                safeExit('main', 1, 'ink-cli-error');
                            }

                            safeExit('main', 0);
                        }
                    }
                    // falls through - safeExit returns never, but eslint doesn't know that

                    case 'web': {
                        // Default to 3000 for web mode
                        const defaultPort = opts.port ? parseInt(opts.port, 10) : 3000;
                        const port = getPort(process.env.PORT, defaultPort, 'PORT');
                        const serverUrl = process.env.DEXTO_URL ?? `http://localhost:${port}`;

                        // Resolve webRoot path (embedded WebUI dist folder)
                        const webRoot = resolveWebRoot();
                        if (!webRoot) {
                            console.warn(chalk.yellow('⚠️  WebUI not found in this build.'));
                            console.info('For production: Run "pnpm build:all" to embed the WebUI');
                            console.info('For development: Run "pnpm dev" for hot reload');
                        }

                        // Build WebUI runtime config (analytics, etc.) for injection into index.html
                        const webUIConfig = webRoot
                            ? { analytics: await getWebUIAnalyticsConfig() }
                            : undefined;

                        // Start single Hono server serving both API and WebUI
                        await startHonoApiServer(
                            agent,
                            port,
                            agent.config.agentCard || {},
                            derivedAgentId,
                            webRoot,
                            webUIConfig
                        );

                        console.log(chalk.green(`✅ Server running at ${serverUrl}`));

                        // Show update notification if available
                        const webUpdateInfo = await versionCheckPromise;
                        if (webUpdateInfo) {
                            displayUpdateNotification(webUpdateInfo);
                        }

                        // Open WebUI in browser if webRoot is available
                        if (webRoot) {
                            try {
                                const { default: open } = await import('open');
                                await open(serverUrl, { wait: false });
                                console.log(
                                    chalk.green(`🌐 Opened WebUI in browser: ${serverUrl}`)
                                );
                            } catch (_error) {
                                console.log(chalk.yellow(`💡 WebUI is available at: ${serverUrl}`));
                            }
                        }

                        break;
                    }

                    // Start server with REST APIs and SSE on port 3001
                    // This also enables dexto to be used as a remote mcp server at localhost:3001/mcp
                    case 'server': {
                        // Start server with REST APIs and SSE only
                        const agentCard = agent.config.agentCard ?? {};
                        // Default to 3001 for server mode
                        const defaultPort = opts.port ? parseInt(opts.port, 10) : 3001;
                        const apiPort = getPort(process.env.PORT, defaultPort, 'PORT');
                        const apiUrl = process.env.DEXTO_URL ?? `http://localhost:${apiPort}`;

                        console.log('🌐 Starting server (REST APIs + SSE)...');
                        await startHonoApiServer(agent, apiPort, agentCard, derivedAgentId);
                        console.log(`✅ Server running at ${apiUrl}`);
                        console.log('Available endpoints:');
                        console.log('  POST /api/message - Send async message');
                        console.log('  POST /api/message-sync - Send sync message');
                        console.log('  POST /api/reset - Reset conversation');
                        console.log('  GET  /api/mcp/servers - List MCP servers');
                        console.log('  SSE support available for real-time events');

                        // Show update notification if available
                        const serverUpdateInfo = await versionCheckPromise;
                        if (serverUpdateInfo) {
                            displayUpdateNotification(serverUpdateInfo);
                        }
                        break;
                    }

                    // TODO: Remove if server mode is stable and supports mcp
                    // Starts dexto as a local mcp server
                    // Use `dexto --mode mcp` to start dexto as a local mcp server
                    // Use `dexto --mode server` to start dexto as a remote server
                    case 'mcp': {
                        // Start stdio mcp server only
                        const agentCardConfig = agent.config.agentCard || {
                            name: 'dexto',
                            version: '1.0.0',
                        };

                        try {
                            // Logs are already redirected to file by default to prevent interference with stdio transport
                            const agentCardData = createAgentCard(
                                {
                                    defaultName: agentCardConfig.name ?? 'dexto',
                                    defaultVersion: agentCardConfig.version ?? '1.0.0',
                                    defaultBaseUrl: 'stdio://local-dexto',
                                },
                                agentCardConfig // preserve overrides from agent file
                            );
                            // Use stdio transport in mcp mode
                            const mcpTransport = await createMcpTransport('stdio');
                            await initializeMcpServer(agent, agentCardData, mcpTransport);
                        } catch (err) {
                            // Write to stderr instead of stdout to avoid interfering with MCP protocol
                            process.stderr.write(`MCP server startup failed: ${err}\n`);
                            safeExit('main', 1, 'mcp-startup-failed');
                        }
                        break;
                    }

                    default:
                        if (opts.mode === 'discord' || opts.mode === 'telegram') {
                            console.error(
                                `❌ Error: '${opts.mode}' mode has been moved to examples`
                            );
                            console.error('');
                            console.error(
                                `The ${opts.mode} bot is now a standalone example that you can customize.`
                            );
                            console.error('');
                            console.error(`📖 See: examples/${opts.mode}-bot/README.md`);
                            console.error('');
                            console.error(`To run it:`);
                            console.error(`  cd examples/${opts.mode}-bot`);
                            console.error(`  pnpm install`);
                            console.error(`  pnpm start`);
                        } else {
                            console.error(
                                `❌ Unknown mode '${opts.mode}'. Use web, cli, server, or mcp.`
                            );
                        }
                        safeExit('main', 1, 'unknown-mode');
                }
            },
            { timeoutMs: 0 }
        )
    );

// 17) PARSE & EXECUTE
program.parseAsync(process.argv);
