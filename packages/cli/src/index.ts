#!/usr/bin/env node
// Load environment variables FIRST with layered loading
import { applyLayeredEnvironmentLoading } from './utils/env.js';

// Apply layered environment loading before any other imports
await applyLayeredEnvironmentLoading();

import { existsSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { Command } from 'commander';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { initAnalytics, capture } from './analytics/index.js';
import { withAnalytics, safeExit, ExitSignal } from './analytics/wrapper.js';

// Use createRequire to import package.json without experimental warning
const require = createRequire(import.meta.url);
const pkg = require('../package.json');

import {
    logger,
    getProviderFromModel,
    getAllSupportedModels,
    DextoAgent,
    type LLMProvider,
    isPath,
    resolveApiKeyForProvider,
    getPrimaryApiKeyEnvVar,
} from '@dexto/core';
import {
    resolveAgentPath,
    getAgentRegistry,
    loadAgentConfig,
    globalPreferencesExist,
    loadGlobalPreferences,
} from '@dexto/agent-management';
import type { ValidatedAgentConfig } from '@dexto/core';
import { startHonoApiServer } from './api/server-hono.js';
import { startDiscordBot } from './discord/bot.js';
import { startTelegramBot } from './telegram/bot.js';
import { validateCliOptions, handleCliOptionsError } from './cli/utils/options.js';
import { validateAgentConfig } from './cli/utils/config-validation.js';
import { applyCLIOverrides } from './config/cli-overrides.js';
import { enrichAgentConfig } from '@dexto/agent-management';
import { getPort } from './utils/port-utils.js';
import {
    createDextoProject,
    createTsconfigJson,
    addDextoScriptsToPackageJson,
    postCreateDexto,
    initDexto,
    postInitDexto,
    getUserInputToInitDextoApp,
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
} from './cli/commands/index.js';
import {
    handleSessionListCommand,
    handleSessionHistoryCommand,
    handleSessionDeleteCommand,
    handleSessionSearchCommand,
} from './cli/commands/session-commands.js';
import { requiresSetup } from './cli/utils/setup-utils.js';
import { checkForFileInCurrentDirectory, FileNotFoundError } from './cli/utils/package-mgmt.js';
import { startNextJsWebServer } from './web.js';
import { initializeMcpServer, createMcpTransport } from '@dexto/server';
import { createAgentCard } from '@dexto/core';
import { initializeMcpToolAggregationServer } from './api/mcp/tool-aggregation-handler.js';
import { CLIConfigOverrides } from './config/cli-overrides.js';

const program = new Command();

// Initialize analytics early (no-op if disabled)
await initAnalytics({ appVersion: pkg.version });

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
    .option('--router <router>', 'Specify the LLM router to use (vercel or in-built)')
    .option('--auto-approve', 'Always approve tool executions without confirmation prompts')
    .option('-c, --continue', 'Continue most recent session (requires -p/prompt)')
    .option('-r, --resume <sessionId>', 'Resume specific session (requires -p/prompt)')
    .option(
        '--mode <mode>',
        'The application in which dexto should talk to you - web | cli | server | discord | telegram | mcp',
        'web'
    )
    .option('--web-port <port>', 'port for the web UI (default: 3000)', '3000')
    .option('--api-port <port>', 'port for the API server (default: web-port + 1)')
    .option('--no-auto-install', 'Disable automatic installation of missing agents from registry')
    .enablePositionalOptions();

// 2) `create-app` SUB-COMMAND
program
    .command('create-app')
    .description('Scaffold a new Dexto Typescript app')
    .action(
        withAnalytics('create-app', async () => {
            try {
                p.intro(chalk.inverse('Dexto Create App'));
                // first setup the initial files in the project and get the project path
                const appPath = await createDextoProject();

                // then get user inputs for directory, llm etc.
                const userInput = await getUserInputToInitDextoApp();
                try {
                    capture('dexto_create', {
                        provider: userInput.llmProvider,
                        providedKey: Boolean(userInput.llmApiKey),
                    });
                } catch {
                    // Analytics failures should not block CLI execution.
                }

                // move to project directory, then add the dexto scripts to the package.json and create the tsconfig.json
                process.chdir(appPath);
                await addDextoScriptsToPackageJson(userInput.directory, appPath);
                await createTsconfigJson(appPath, userInput.directory);

                // then initialize the other parts of the project
                await initDexto(
                    userInput.directory,
                    userInput.createExampleFile,
                    userInput.llmProvider,
                    userInput.llmApiKey
                );
                p.outro(chalk.greenBright('Dexto app created and initialized successfully!'));
                // add notes for users to get started with their newly created Dexto project
                await postCreateDexto(appPath, userInput.directory);
                safeExit('create-app', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto create-app command failed: ${err}`);
                safeExit('create-app', 1, 'error');
            }
        })
    );

// 3) `init-app` SUB-COMMAND
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

// 4) `setup` SUB-COMMAND
program
    .command('setup')
    .description('Configure global Dexto preferences')
    .option('--provider <provider>', 'LLM provider (openai, anthropic, google, groq)')
    .option('--model <model>', 'Model name (uses provider default if not specified)')
    .option('--default-agent <agent>', 'Default agent name (default: default-agent)')
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

// 5) `install` SUB-COMMAND
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
  $ dexto install default-agent              Install agent from registry
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

// 6) `uninstall` SUB-COMMAND
program
    .command('uninstall [agents...]')
    .description('Uninstall agents from the local installation')
    .option('--all', 'Uninstall all installed agents')
    .option('--force', 'Force uninstall even if agent is protected (e.g., default-agent)')
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

// 7) `list-agents` SUB-COMMAND
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

// 8) `which` SUB-COMMAND
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

// Helper to bootstrap a minimal agent for non-interactive session/search ops
async function bootstrapAgentFromGlobalOpts() {
    const globalOpts = program.opts();
    const resolvedPath = await resolveAgentPath(
        globalOpts.agent,
        globalOpts.autoInstall !== false,
        true
    );
    const rawConfig = await loadAgentConfig(resolvedPath);
    const mergedConfig = applyCLIOverrides(rawConfig, globalOpts);
    const enrichedConfig = enrichAgentConfig(mergedConfig, resolvedPath);

    // Override approval config for read-only commands (never run conversations)
    // This avoids needing to set up unused approval handlers
    enrichedConfig.toolConfirmation = {
        mode: 'auto-approve',
        timeout: enrichedConfig.toolConfirmation?.timeout ?? 120000,
    };
    enrichedConfig.elicitation = {
        enabled: false,
        timeout: enrichedConfig.elicitation?.timeout ?? 120000,
    };

    const agent = new DextoAgent(enrichedConfig, resolvedPath);
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

// 9) `session` SUB-COMMAND
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

// 10) `search` SUB-COMMAND
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

// 11) `mcp` SUB-COMMAND
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
                        globalOpts.autoInstall !== false,
                        true
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

// 10) Main dexto CLI - Interactive/One shot (CLI/HEADLESS) or run in other modes (--mode web/discord/telegram)
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
            '  dexto --mode discord     Run as Discord bot\n' +
            '  dexto --mode telegram    Run as Telegram bot\n' +
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

                try {
                    // Case 1: File path - skip all validation and setup
                    if (opts.agent && isPath(opts.agent)) {
                        resolvedPath = await resolveAgentPath(
                            opts.agent,
                            opts.autoInstall !== false,
                            true
                        );
                    }
                    // Cases 2 & 3: Default agent or registry agent
                    else {
                        // Early registry validation for named agents
                        if (opts.agent) {
                            const registry = getAgentRegistry();
                            if (!registry.hasAgent(opts.agent)) {
                                console.error(`❌ Agent '${opts.agent}' not found in registry`);

                                // Show available agents
                                const available = Object.keys(registry.getAvailableAgents());
                                if (available.length > 0) {
                                    console.log(`📋 Available agents: ${available.join(', ')}`);
                                } else {
                                    console.log('📋 No agents available in registry');
                                }
                                safeExit('main', 1, 'agent-not-in-registry');
                                return;
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
                        }

                        // Now resolve agent (will auto-install with preferences since setup is complete)
                        resolvedPath = await resolveAgentPath(
                            opts.agent,
                            opts.autoInstall !== false,
                            true
                        );
                    }

                    // Load raw config and apply CLI overrides
                    const rawConfig = await loadAgentConfig(resolvedPath);
                    const mergedConfig = applyCLIOverrides(rawConfig, opts as CLIConfigOverrides);

                    // Enrich config with per-agent paths BEFORE validation
                    // Enrichment adds filesystem paths to storage (schema has in-memory defaults)
                    // Interactive CLI mode: only log to file (console would interfere with chat UI)
                    const isInteractiveCli = opts.mode === 'cli' && !headlessInput;
                    const enrichedConfig = enrichAgentConfig(
                        mergedConfig,
                        resolvedPath,
                        isInteractiveCli
                    );

                    // Validate enriched config with interactive setup if needed (for API key issues)
                    validatedConfig = await validateAgentConfig(
                        enrichedConfig,
                        opts.interactive !== false
                    );
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
                        console.error('💡 Use interactive CLI mode, or update your config:');
                        console.error(
                            '   - Set toolConfirmation.mode to "auto-approve" or "auto-deny"'
                        );
                        console.error('   - Set elicitation.enabled to false');
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
                            `💡 These features require interactive UI and are only supported in: ${supportedModes.join(', ')}`
                        );
                        console.error('   Update your config:');
                        console.error(
                            '   - Set toolConfirmation.mode to "auto-approve" or "auto-deny"'
                        );
                        console.error('   - Set elicitation.enabled to false');
                        safeExit('main', 1, 'approval-unsupported-mode');
                    }
                }

                // ——— CREATE AGENT ———
                let agent: DextoAgent;
                let derivedAgentId: string;
                try {
                    console.error(`🚀 Initializing Dexto with config: ${resolvedPath}`);

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
                    agent = new DextoAgent(validatedConfig, resolvedPath);

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
                        // Ink CLI uses ApprovalCoordinator (same as server/web mode) to coordinate
                        // approval requests with React UI components
                        const needsHandler =
                            !headlessInput &&
                            (validatedConfig.toolConfirmation?.mode === 'manual' ||
                                validatedConfig.elicitation.enabled);

                        if (needsHandler) {
                            const { createManualApprovalHandler, ApprovalCoordinator } =
                                await import('@dexto/server');
                            const approvalCoordinator = new ApprovalCoordinator();
                            const handler = createManualApprovalHandler(approvalCoordinator);
                            agent.setApprovalHandler(handler);
                            logger.debug('Event-based approval handler configured for Ink CLI');
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
                            // Defer session creation until first message is sent to prevent stale empty sessions
                            const cliSessionId: string | null = null;

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
                                await startInkCliRefactored(agent, cliSessionId);
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
                        break;
                    }

                    case 'web': {
                        const webPort = parseInt(opts.webPort, 10);
                        const frontPort = getPort(
                            process.env.FRONTEND_PORT,
                            webPort,
                            'FRONTEND_PORT'
                        );
                        // Use explicit --api-port if provided, otherwise default to webPort + 1
                        const defaultApiPort = opts.apiPort
                            ? parseInt(opts.apiPort, 10)
                            : webPort + 1;
                        const apiPort = getPort(process.env.API_PORT, defaultApiPort, 'API_PORT');
                        const apiUrl = process.env.API_URL ?? `http://localhost:${apiPort}`;
                        const nextJSserverURL =
                            process.env.FRONTEND_URL ?? `http://localhost:${frontPort}`;

                        // Start API server (Hono)
                        await startHonoApiServer(
                            agent,
                            apiPort,
                            agent.config.agentCard || {},
                            derivedAgentId
                        );

                        // Start Next.js web server
                        const webServerStarted = await startNextJsWebServer(
                            apiUrl,
                            frontPort,
                            nextJSserverURL
                        );

                        // Open WebUI in browser if server started successfully
                        if (webServerStarted) {
                            try {
                                const { default: open } = await import('open');
                                await open(nextJSserverURL, { wait: false });
                                console.log(
                                    chalk.green(`🌐 Opened WebUI in browser: ${nextJSserverURL}`)
                                );
                            } catch (_error) {
                                console.log(
                                    chalk.yellow(`💡 WebUI is available at: ${nextJSserverURL}`)
                                );
                            }
                        }

                        break;
                    }

                    // Start server with REST APIs and SSE on port 3001
                    // This also enables dexto to be used as a remote mcp server at localhost:3001/mcp
                    case 'server': {
                        // Start server with REST APIs and SSE only
                        const agentCard = agent.config.agentCard ?? {};
                        // Use explicit --api-port if provided, otherwise default to 3001
                        const defaultApiPort = opts.apiPort ? parseInt(opts.apiPort, 10) : 3001;
                        const apiPort = getPort(process.env.API_PORT, defaultApiPort, 'API_PORT');
                        const apiUrl = process.env.API_URL ?? `http://localhost:${apiPort}`;

                        console.log('🌐 Starting server (REST APIs + SSE)...');
                        await startHonoApiServer(agent, apiPort, agentCard, derivedAgentId);
                        console.log(`✅ Server running at ${apiUrl}`);
                        console.log('Available endpoints:');
                        console.log('  POST /api/message - Send async message');
                        console.log('  POST /api/message-sync - Send sync message');
                        console.log('  POST /api/reset - Reset conversation');
                        console.log('  GET  /api/mcp/servers - List MCP servers');
                        console.log('  SSE support available for real-time events');
                        break;
                    }

                    case 'discord':
                        console.log('🤖 Starting Discord bot…');
                        try {
                            startDiscordBot(agent);
                        } catch (err) {
                            console.error('❌ Discord startup failed:', err);
                            safeExit('main', 1, 'discord-startup-failed');
                        }
                        break;

                    case 'telegram':
                        console.log('🤖 Starting Telegram bot…');
                        try {
                            startTelegramBot(agent);
                        } catch (err) {
                            console.error('❌ Telegram startup failed:', err);
                            safeExit('main', 1, 'telegram-startup-failed');
                        }
                        break;

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
                        console.error(
                            `❌ Unknown mode '${opts.mode}'. Use web, cli, server, discord, telegram, or mcp.`
                        );
                        safeExit('main', 1, 'unknown-mode');
                }
            },
            { timeoutMs: 0 }
        )
    );

// 11) PARSE & EXECUTE
program.parseAsync(process.argv);
