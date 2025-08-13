#!/usr/bin/env node
// Load environment variables FIRST with layered loading
import { applyLayeredEnvironmentLoading } from '../core/utils/env.js';

// Apply layered environment loading before any other imports
await applyLayeredEnvironmentLoading();

import { existsSync } from 'fs';
import { Command } from 'commander';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import pkg from '../../package.json' with { type: 'json' };

import {
    logger,
    resolveConfigPath,
    getProviderFromModel,
    getAllSupportedModels,
    DextoAgent,
    loadAgentConfig,
    LLMProvider,
    getDefaultAgentRegistry,
} from '@core/index.js';
import { DEFAULT_CONFIG_PATH } from '@core/utils/path.js';
import type { AgentConfig } from '@core/agent/schemas.js';
import { resolveApiKeyForProvider } from '@core/utils/api-key-resolver.js';
import { startAiCli, startHeadlessCli } from './cli/cli.js';
import { startApiAndLegacyWebUIServer } from './api/server.js';
import { startDiscordBot } from './discord/bot.js';
import { startTelegramBot } from './telegram/bot.js';
import { validateCliOptions, handleCliOptionsError } from './cli/utils/options.js';
import { validateAgentConfig } from './cli/utils/config-validation.js';
import { applyCLIOverrides, CLIConfigOverrides } from './config/cli-overrides.js';
import { isFirstTimeUserScenario, handleFirstTimeSetup } from './cli/utils/first-time-setup.js';
import { getPort } from '@core/utils/port-utils.js';
import {
    createDextoProject,
    createTsconfigJson,
    addDextoScriptsToPackageJson,
    postCreateDexto,
    initDexto,
    postInitDexto,
    getUserInputToInitDextoApp,
} from './cli/project-commands/index.js';
import { checkForFileInCurrentDirectory, FileNotFoundError } from './cli/utils/package-mgmt.js';
import { startNextJsWebServer } from './web.js';
import { initializeMcpServer, createMcpTransport } from './api/mcp/mcp_handler.js';
import { createAgentCard } from '@core/config/agentCard.js';
import { initializeMcpToolAggregationServer } from './api/mcp/tool-aggregation-handler.js';

const program = new Command();

// 1) GLOBAL OPTIONS
program
    .name('dexto')
    .description('AI-powered CLI and WebUI for interacting with MCP servers')
    .version(pkg.version, '-v, --version', 'output the current version')
    .option(
        '-a, --agent <path>',
        'Agent name (from registry) or path to agent config file',
        DEFAULT_CONFIG_PATH
    )
    .option(
        '-p, --prompt <text>',
        'One-shot prompt text. Alternatively provide a single quoted string as positional argument.'
    )
    .option('-s, --strict', 'Require all server connections to succeed')
    .option('--no-verbose', 'Disable verbose output')
    .option('-m, --model <model>', 'Specify the LLM model to use. ')
    .option('-r, --router <router>', 'Specify the LLM router to use (vercel or in-built)')
    .option('--new-session [sessionId]', 'Start with a new session (optionally specify session ID)')
    .option(
        '--mode <mode>',
        'The application in which dexto should talk to you - cli | web | server | discord | telegram | mcp',
        'cli'
    )
    .option('--web-port <port>', 'optional port for the web UI', '3000')
    .option('--skip-interactive', 'Disable interactive prompts (fail instead of prompting)');

// 2) `create-app` SUB-COMMAND
program
    .command('create-app')
    .description('Scaffold a new Dexto Typescript app')
    .action(async () => {
        try {
            p.intro(chalk.inverse('Dexto Create App'));
            // first setup the initial files in the project and get the project path
            const appPath = await createDextoProject();

            // then get user inputs for directory, llm etc.
            const userInput = await getUserInputToInitDextoApp();

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
            process.exit(0);
        } catch (err) {
            console.error(`❌ dexto create-app command failed: ${err}`);
            process.exit(1);
        }
    });

// 3) `init-app` SUB-COMMAND
program
    .command('init-app')
    .description('Initialize an existing Typescript app with Dexto')
    .action(async () => {
        try {
            // pre-condition: check that package.json and tsconfig.json exist in current directory to know that project is valid
            await checkForFileInCurrentDirectory('package.json');
            await checkForFileInCurrentDirectory('tsconfig.json');

            // start intro
            p.intro(chalk.inverse('Dexto Init App'));
            const userInput = await getUserInputToInitDextoApp();
            await initDexto(
                userInput.directory,
                userInput.createExampleFile,
                userInput.llmProvider,
                userInput.llmApiKey
            );
            p.outro(chalk.greenBright('Dexto app initialized successfully!'));

            // add notes for users to get started with their new initialized Dexto project
            await postInitDexto(userInput.directory);
            process.exit(0);
        } catch (err) {
            // if the package.json or tsconfig.json is not found, we give instructions to create a new project
            if (err instanceof FileNotFoundError) {
                console.error(`❌ ${err.message} Run "dexto create-app" to create a new app`);
                process.exit(1);
            }
            console.error(`❌ Initialization failed: ${err}`);
            process.exit(1);
        }
    });

// 4) `list-agents` SUB-COMMAND
program
    .command('list-agents')
    .description('List all available agents in the registry')
    .action(async () => {
        try {
            const registry = getDefaultAgentRegistry();
            const agents = await registry.listAgents();

            if (agents.length === 0) {
                console.log(chalk.yellow('No agents found in the registry.'));
                return;
            }

            console.log(chalk.bold.cyan('\n📋 Available Agents:\n'));

            agents.forEach((agent) => {
                console.log(chalk.bold.green(`• ${agent.name}`));
                console.log(chalk.dim(`  ${agent.description}`));
                if (agent.tags && agent.tags.length > 0) {
                    console.log(chalk.dim(`  Tags: ${agent.tags.join(', ')}`));
                }
                console.log(); // Empty line for spacing
            });

            console.log(chalk.dim(`Total: ${agents.length} agents available`));
            console.log(chalk.dim('\nUsage examples:'));
            console.log(
                chalk.dim(`  npx @truffle-ai/dexto -a ${agents[0]?.name || 'github-agent'}`)
            );
            console.log(
                chalk.dim(`  npx @truffle-ai/dexto --agent ${agents[0]?.name || 'github-agent'}`)
            );
            console.log(chalk.dim('  npx @truffle-ai/dexto --agent /path/to/custom-agent.yml'));
        } catch (error) {
            console.error(
                `❌ Failed to list agents: ${error instanceof Error ? error.message : String(error)}`
            );
            process.exit(1);
        }
    });

// 5) `mcp` SUB-COMMAND
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
    .action(async (options) => {
        try {
            // Validate that --group-servers flag is provided (mandatory for now)
            if (!options.groupServers) {
                console.error(
                    '❌ The --group-servers flag is required. This command currently only supports aggregating and re-exposing tools from configured MCP servers.'
                );
                console.error('Usage: dexto mcp --group-servers');
                process.exit(1);
            }

            // Load and resolve config
            // Get the global agent option from the main program
            const globalOpts = program.opts();
            const configPath = globalOpts.agent;

            const config = await loadAgentConfig(configPath);
            console.log(`📄 Loading Dexto config from: ${resolveConfigPath(configPath)}`);

            // Validate that MCP servers are configured
            if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
                console.error(
                    '❌ No MCP servers configured. Please configure mcpServers in your config file.'
                );
                process.exit(1);
            }

            // Logs are already redirected to file by default to prevent interference with stdio transport
            const currentLogPath = logger.getLogFilePath();
            logger.info(`MCP mode using log file: ${currentLogPath || 'default .dexto location'}`);

            logger.info(
                `Starting MCP tool aggregation server: ${options.name} v${options.version}`
            );
            logger.info(`Configured MCP servers: ${Object.keys(config.mcpServers).join(', ')}`);

            // Create stdio transport for MCP tool aggregation
            const mcpTransport = await createMcpTransport('stdio');

            // Initialize tool aggregation server
            await initializeMcpToolAggregationServer(
                config.mcpServers,
                mcpTransport,
                options.name,
                options.version,
                options.strict
            );

            logger.info('MCP tool aggregation server started successfully');
        } catch (err) {
            // Write to stderr to avoid interfering with MCP protocol
            process.stderr.write(`MCP tool aggregation server startup failed: ${err}\n`);
            process.exit(1);
        }
    });

// 5) Main dexto CLI - Interactive/One shot (CLI/HEADLESS) or run in other modes (--mode web/discord/telegram)
program
    .argument(
        '[prompt...]',
        'Natural-language prompt to run once. If not passed, dexto will start as an interactive CLI'
    )
    // Main customer facing description
    .description(
        'Dexto CLI allows you to talk to Dexto, build custom AI Agents, ' +
            'build complex AI applications like Cursor, and more.\n\n' +
            // TODO: Add `dexto tell me about your cli` starter prompt
            'Run dexto interactive CLI with `dexto` or run a one-shot prompt with `dexto -p "<prompt>"` or `dexto "<prompt>"`\n' +
            'Use available agents: `dexto -a github-agent`, `dexto -a database-agent`, etc.\n' +
            'List all available agents with `dexto list-agents`\n' +
            'Start with a new session using `dexto --new-session [sessionId]`\n' +
            'Run dexto web UI with `dexto --mode web`\n' +
            'Run dexto as a server (REST APIs + WebSockets) with `dexto --mode server`\n' +
            'Run dexto as a discord bot with `dexto --mode discord`\n' +
            'Run dexto as a telegram bot with `dexto --mode telegram`\n' +
            'Run dexto agent as an MCP server with `dexto --mode mcp`\n' +
            'Run dexto as an MCP server aggregator with `dexto mcp --group-servers`\n\n' +
            'Check subcommands for more features. Check https://github.com/truffle-ai/dexto for documentation on how to customize dexto and other examples'
    )
    .action(async (prompt: string[] = []) => {
        // ——— ENV CHECK (optional) ———
        if (!existsSync('.env')) {
            logger.debug('WARNING: .env file not found; copy .env.example and set your API keys.');
        }

        // Check if any API key is available for common providers
        const commonProviders: LLMProvider[] = [
            'openai',
            'google',
            'anthropic',
            'groq',
            'xai',
            'cohere',
        ];
        const hasApiKey = commonProviders.some((provider) => resolveApiKeyForProvider(provider));

        if (!hasApiKey) {
            console.log(
                chalk.yellow(
                    '⚠️  No API keys found for common LLM providers (OpenAI, Google, Anthropic, etc.)'
                )
            );
            console.log(
                chalk.dim(
                    'You may need to set up API keys in your .env file to use certain features.'
                )
            );
        }

        const opts = program.opts();
        let headlessInput: string | undefined = undefined;

        // Prefer explicit -p/--prompt for headless one-shot
        if (opts.prompt) {
            headlessInput = String(opts.prompt);
        } else if (prompt.length > 0) {
            // Enforce quoted single positional argument for headless mode
            if (prompt.length === 1) {
                headlessInput = prompt[0];
            } else {
                console.error(
                    '❌ For headless one-shot mode, pass the prompt in double quotes as a single argument (e.g., "say hello") or use -p/--prompt.'
                );
                process.exit(1);
            }
        }

        // Note: Agent selection must be passed via -a/--agent. We no longer interpret
        // the first positional argument as an agent name to avoid ambiguity with prompts.

        // ——— Infer provider & API key from model ———
        if (opts.model) {
            let provider: LLMProvider;
            try {
                provider = getProviderFromModel(opts.model);
            } catch (err) {
                console.error(`❌ ${(err as Error).message}`);
                console.error(`Supported models: ${getAllSupportedModels().join(', ')}`);
                process.exit(1);
            }

            const apiKey = resolveApiKeyForProvider(provider);
            if (!apiKey) {
                console.error(
                    `❌ Missing API key for provider '${provider}' - please set the appropriate environment variable`
                );
                process.exit(1);
            }
            opts.provider = provider;
            opts.apiKey = apiKey;
        }

        try {
            validateCliOptions(opts);
        } catch (err) {
            handleCliOptionsError(err);
        }

        // ——— LOAD AND PREPARE CONFIG ———
        let validatedConfig: AgentConfig;
        try {
            // Check for first-time user scenario BEFORE loading config
            const resolvedPath = resolveConfigPath(opts.agent);
            if (isFirstTimeUserScenario(resolvedPath)) {
                if (opts.skipInteractive) {
                    console.error(
                        chalk.red(
                            '❌ First-time setup required but --skip-interactive flag is set.'
                        )
                    );
                    console.error(
                        chalk.dim(
                            'Please run without --skip-interactive to complete setup, or provide a valid config file.'
                        )
                    );
                    process.exit(1);
                }
                // Handle first-time setup (provider selection, config creation, API key)
                const setupComplete = await handleFirstTimeSetup();
                if (!setupComplete) {
                    console.log(chalk.dim('\n👋 Run dexto again when ready!'));
                    process.exit(0);
                }
                // Config has been created, continue with normal flow
            }

            // Load raw config and apply CLI overrides
            const rawConfig = await loadAgentConfig(opts.agent);
            const mergedConfig = applyCLIOverrides(rawConfig, opts as CLIConfigOverrides);

            // Validate with interactive setup if needed (for API key issues)
            validatedConfig = await validateAgentConfig(mergedConfig, !opts.skipInteractive);
        } catch (err) {
            // Config loading failed completely
            console.error(`❌ Failed to load configuration: ${err}`);
            process.exit(1);
        }

        // ——— CREATE AGENT ———
        let agent: DextoAgent;
        try {
            const configPath = opts.agent === DEFAULT_CONFIG_PATH ? undefined : opts.agent;

            // Resolve the actual config path for display (using the same logic as loadAgentConfig)
            let displayPath: string;
            if (configPath) {
                try {
                    const registry = getDefaultAgentRegistry();
                    displayPath = await registry.resolveAgent(configPath);
                } catch (_error) {
                    displayPath = resolveConfigPath(configPath);
                }
            } else {
                // When configPath is undefined, resolveConfigPath will use default behavior
                displayPath = resolveConfigPath(undefined);
            }

            console.log(`🚀 Initializing Dexto with config: ${displayPath}`);
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

            // DextoAgent will parse/validate again (parse-twice pattern)
            agent = new DextoAgent(validatedConfig, opts.agent);

            // Start the agent (initialize async services)
            await agent.start();

            // Handle --new-session flag
            if (opts.newSession !== undefined) {
                try {
                    // Use provided session ID or generate a random one
                    const sessionId =
                        typeof opts.newSession === 'string' && opts.newSession
                            ? opts.newSession
                            : undefined; // Let agent generate random ID

                    const session = await agent.createSession(sessionId);
                    await agent.loadSession(session.id);

                    logger.info(`Created and loaded new session: ${session.id}`, null, 'green');
                } catch (err) {
                    console.error(
                        `❌ Failed to create new session: ${err instanceof Error ? err.message : String(err)}`
                    );
                    process.exit(1);
                }
            }
        } catch (err) {
            // Ensure config errors are shown to user, not hidden in logs
            console.error(`❌ Configuration Error: ${(err as Error).message}`);
            process.exit(1);
        }

        // ——— Dispatch based on --mode ———
        switch (opts.mode) {
            case 'cli': {
                // Set up CLI tool confirmation subscriber
                const { CLIToolConfirmationSubscriber } = await import(
                    './cli/tool-confirmation/cli-confirmation-handler.js'
                );
                const cliSubscriber = new CLIToolConfirmationSubscriber();
                cliSubscriber.subscribe(agent.agentEventBus);
                logger.info('Setting up CLI event subscriptions...');

                if (headlessInput) {
                    // One shot CLI
                    await startHeadlessCli(agent, headlessInput);
                    process.exit(0);
                } else {
                    await startAiCli(agent); // Interactive CLI
                }
                break;
            }

            case 'web': {
                const webPort = parseInt(opts.webPort, 10);
                const frontPort = getPort(process.env.FRONTEND_PORT, webPort, 'FRONTEND_PORT');
                const apiPort = getPort(process.env.API_PORT, webPort + 1, 'API_PORT');
                const apiUrl = process.env.API_URL ?? `http://localhost:${apiPort}`;
                const nextJSserverURL = process.env.FRONTEND_URL ?? `http://localhost:${frontPort}`;

                // Start API server first with legacy web UI
                await startApiAndLegacyWebUIServer(
                    agent,
                    apiPort,
                    true,
                    agent.getEffectiveConfig().agentCard || {}
                );

                // Start Next.js web server
                await startNextJsWebServer(apiUrl, frontPort, nextJSserverURL);

                break;
            }

            // Start server with REST APIs and WebSockets on port 3001
            // This also enables dexto to be used as a remote mcp server at localhost:3001/mcp
            case 'server': {
                // Start server with REST APIs and WebSockets only
                const agentCard = agent.getEffectiveConfig().agentCard ?? {};
                const apiPort = getPort(process.env.API_PORT, 3001, 'API_PORT');
                const apiUrl = process.env.API_URL ?? `http://localhost:${apiPort}`;

                console.log('🌐 Starting server (REST APIs + WebSockets)...');
                await startApiAndLegacyWebUIServer(agent, apiPort, false, agentCard);
                console.log(`✅ Server running at ${apiUrl}`);
                console.log('Available endpoints:');
                console.log('  POST /api/message - Send async message');
                console.log('  POST /api/message-sync - Send sync message');
                console.log('  POST /api/reset - Reset conversation');
                console.log('  GET  /api/mcp/servers - List MCP servers');
                console.log('  WebSocket support available for real-time events');
                break;
            }

            case 'discord':
                console.log('🤖 Starting Discord bot…');
                try {
                    startDiscordBot(agent);
                } catch (err) {
                    console.error('❌ Discord startup failed:', err);
                    process.exit(1);
                }
                break;

            case 'telegram':
                console.log('🤖 Starting Telegram bot…');
                try {
                    startTelegramBot(agent);
                } catch (err) {
                    console.error('❌ Telegram startup failed:', err);
                    process.exit(1);
                }
                break;

            // TODO: Remove if server mode is stable and supports mcp
            // Starts dexto as a local mcp server
            // Use `dexto --mode mcp` to start dexto as a local mcp server
            // Use `dexto --mode server` to start dexto as a remote server
            case 'mcp': {
                // Start stdio mcp server only
                const agentCardConfig = agent.getEffectiveConfig().agentCard || {
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
                        agentCardConfig // preserve overrides from agent.yml
                    );
                    // Use stdio transport in mcp mode
                    const mcpTransport = await createMcpTransport('stdio');
                    await initializeMcpServer(agent, agentCardData, mcpTransport);
                } catch (err) {
                    // Write to stderr instead of stdout to avoid interfering with MCP protocol
                    process.stderr.write(`MCP server startup failed: ${err}\n`);
                    process.exit(1);
                }
                break;
            }

            default:
                console.error(
                    `❌ Unknown mode '${opts.mode}'. Use cli, web, server, discord, telegram, or mcp.`
                );
                process.exit(1);
        }
    });

// 6) PARSE & EXECUTE
program.parseAsync(process.argv);
