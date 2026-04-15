import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { withAnalytics, safeExit, ExitSignal } from './analytics/wrapper.js';
import type { UpdateInfo } from './cli/utils/version-check.js';

function readVersionFromPackageJson(packageJsonPath: string): string | undefined {
    if (!existsSync(packageJsonPath)) {
        return undefined;
    }

    try {
        const content = readFileSync(packageJsonPath, 'utf-8');
        const pkg = JSON.parse(content) as { version?: unknown };
        if (typeof pkg.version === 'string' && pkg.version.length > 0) {
            return pkg.version;
        }
    } catch {
        // Ignore parse/read errors and fall back.
    }

    return undefined;
}

function resolveCliVersion(): string {
    // Regular npm installs: package.json is next to dist/.
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const localPackageJsonPath = path.resolve(scriptDir, '..', 'package.json');
    const localVersion = readVersionFromPackageJson(localPackageJsonPath);
    if (localVersion) {
        return localVersion;
    }

    // Standalone release archives ship package.json next to the executable.
    const packageRoot = getDextoPackageRoot();
    if (packageRoot) {
        const packageJsonPath = path.join(packageRoot, 'package.json');
        const packageVersion = readVersionFromPackageJson(packageJsonPath);
        if (packageVersion) {
            return packageVersion;
        }
    }

    return process.env.DEXTO_CLI_VERSION || '0.0.0';
}

const cliVersion = resolveCliVersion();

// Set CLI version for Dexto Gateway usage tracking
process.env.DEXTO_CLI_VERSION = cliVersion;

import {
    logger,
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
    applyImageDefaults,
    cleanNullValues,
    AgentConfigSchema,
    loadImage,
    resolveServicesFromConfig,
    toDextoAgentOptions,
    type DextoImage,
    type ValidatedAgentConfig,
} from '@dexto/agent-config';
import {
    getDextoPackageRoot,
    resolveAgentPath,
    loadAgentConfig,
    findDextoProjectRoot,
    globalPreferencesExist,
    loadGlobalPreferences,
    resolveBundledScript,
    enrichAgentConfig,
    isDextoAuthEnabled,
} from '@dexto/agent-management';
import { validateCliOptions, handleCliOptionsError } from './cli/utils/options.js';
import { validateAgentConfig } from './cli/utils/config-validation.js';
import {
    applyCLIOverrides,
    applyStartupLLMFallback,
    applyUserPreferences,
} from './config/cli-overrides.js';
import { registerRunCommand } from './cli/commands/run/register.js';
import { registerSessionCommand } from './cli/commands/session/register.js';
import { registerSearchCommand } from './cli/commands/search/register.js';
import { registerAuthCommand } from './cli/commands/auth/register.js';
import { registerBillingCommand } from './cli/commands/billing/register.js';
import { registerMcpCommand } from './cli/commands/mcp/register.js';
import { registerImageCommand } from './cli/commands/image/register.js';
import { registerPluginCommand } from './cli/commands/plugin/register.js';
import { registerAgentsCommand } from './cli/commands/agents/register.js';
import { registerDeployCommand } from './cli/commands/deploy/register.js';
import { registerInitCommand } from './cli/commands/init.js';
import type { BootstrapAgentMode } from './cli/commands/register-context.js';
import type { MainModeOptions } from './cli/modes/context.js';
import type { CLIConfigOverrides } from './config/cli-overrides.js';
import type { CreateAppOptions } from './cli/commands/create-app.js';
import type { CLISetupOptionsInput } from './cli/commands/setup.js';
import type { UpgradeCommandOptions } from './cli/commands/upgrade.js';
import type { UninstallCliCommandOptions } from './cli/commands/uninstall.js';
import { ensureImageImporterConfigured } from './cli/utils/image-importer.js';

const program = new Command();

let dextoApiKeyBootstrapped = false;
let versionCheckPromise: Promise<UpdateInfo | null> | null = null;
let llmRegistryAutoUpdateStarted = false;

async function ensureDextoApiKeyBootstrap(): Promise<void> {
    if (dextoApiKeyBootstrapped) {
        return;
    }
    if (!isDextoAuthEnabled()) {
        dextoApiKeyBootstrapped = true;
        return;
    }
    const { getDextoApiKey } = await import('./cli/auth/index.js');
    const dextoApiKey = await getDextoApiKey();
    if (dextoApiKey) {
        process.env.DEXTO_API_KEY = dextoApiKey;
    }
    dextoApiKeyBootstrapped = true;
}

async function getVersionCheckResult(): Promise<UpdateInfo | null> {
    if (!versionCheckPromise) {
        const { checkForUpdates } = await import('./cli/utils/version-check.js');
        versionCheckPromise = checkForUpdates(cliVersion);
    }
    return versionCheckPromise;
}

function ensureLlmRegistryAutoUpdateStarted(): void {
    if (llmRegistryAutoUpdateStarted) {
        return;
    }
    startLlmRegistryAutoUpdate();
    llmRegistryAutoUpdateStarted = true;
}

// 1) GLOBAL OPTIONS
program
    .name('dexto')
    .description('AI-powered CLI and WebUI for interacting with MCP servers.')
    .version(cliVersion, '-v, --version', 'output the current version')
    .option('-a, --agent <id|path>', 'Agent ID or path to agent config file')
    .option('--cloud-agent <id>', 'Connect the interactive CLI to a deployed cloud agent by ID')
    .option('-p, --prompt <text>', 'Start the interactive CLI and immediately run the prompt')
    .option('-s, --strict', 'Require all server connections to succeed')
    .option('--no-verbose', 'Disable verbose output')
    .option('--no-interactive', 'Disable interactive prompts and API key setup')
    .option('--skip-setup', 'Skip global setup validation (useful for MCP mode, automation)')
    .option('-m, --model <model>', 'Specify the LLM model to use')
    .option('--auto-approve', 'Always approve tool executions without confirmation prompts')
    .option(
        '--bypass-permissions',
        'Start the interactive CLI in bypass permissions mode (auto-approve approval prompts)'
    )
    .option('--no-elicitation', 'Disable elicitation (agent cannot prompt user for input)')
    .option('-c, --continue', 'Continue most recent session (CLI mode)')
    .option('-r, --resume <sessionId>', 'Resume a session by ID (CLI mode)')
    .option(
        '--mode <mode>',
        'The application in which dexto should talk to you - web | cli | server | mcp',
        'cli'
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
    .option('--type <type>', 'App type: script, webapp (default: script)')
    .action(
        withAnalytics('create-app', async (name?: string, options?: CreateAppOptions) => {
            try {
                p.intro(chalk.inverse('Create Dexto App'));

                // Create the app project structure (fully self-contained)
                const { createDextoProject } = await import('./cli/commands/create-app.js');
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

registerImageCommand({ program });
registerDeployCommand({ program });
registerInitCommand({ program });

// 4) `init-app` SUB-COMMAND
program
    .command('init-app')
    .description('Initialize an existing Typescript app with Dexto')
    .action(
        withAnalytics('init-app', async () => {
            const { checkForFileInCurrentDirectory, FileNotFoundError } = await import(
                './cli/utils/package-mgmt.js'
            );
            try {
                // pre-condition: check that package.json and tsconfig.json exist in current directory to know that project is valid
                await checkForFileInCurrentDirectory('package.json');
                await checkForFileInCurrentDirectory('tsconfig.json');

                // start intro
                p.intro(chalk.inverse('Dexto Init App'));
                const { getUserInputToInitDextoApp, initDexto, postInitDexto } = await import(
                    './cli/commands/init-app.js'
                );
                const userInput = await getUserInputToInitDextoApp();
                try {
                    const { capture } = await import('./analytics/index.js');
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
                const { handleSetupCommand } = await import('./cli/commands/setup.js');
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

registerAgentsCommand({ program });

// 7) `upgrade` SUB-COMMAND
program
    .command('upgrade [version]')
    .description('Upgrade Dexto CLI (auto-migrates npm installs to native)')
    .option('--dry-run', 'Print commands without executing them')
    .option('--force', 'Force reinstall during upgrade')
    .action(
        withAnalytics(
            'upgrade',
            async (version: string | undefined, options: Partial<UpgradeCommandOptions>) => {
                try {
                    const { handleUpgradeCommand } = await import('./cli/commands/upgrade.js');
                    await handleUpgradeCommand(version, options);
                    safeExit('upgrade', 0);
                } catch (err) {
                    if (err instanceof ExitSignal) throw err;
                    console.error(`❌ dexto upgrade command failed: ${err}`);
                    safeExit('upgrade', 1, 'error');
                }
            }
        )
    );

// 8) `uninstall` SUB-COMMAND (CLI self uninstall)
program
    .command('uninstall')
    .description('Uninstall the Dexto CLI binary (does not uninstall agents)')
    .option('--purge', 'Also remove ~/.dexto completely')
    .option('--dry-run', 'Print actions without deleting files')
    .action(
        withAnalytics('uninstall', async (options: Partial<UninstallCliCommandOptions>) => {
            try {
                const { handleUninstallCliCommand } = await import('./cli/commands/uninstall.js');
                await handleUninstallCliCommand(options);
                safeExit('uninstall', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto uninstall command failed: ${err}`);
                safeExit('uninstall', 1, 'error');
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
                const { handleWhichCommand } = await import('./cli/commands/which.js');
                await handleWhichCommand(agent);
                safeExit('which', 0);
            } catch (err) {
                if (err instanceof ExitSignal) throw err;
                console.error(`❌ dexto which command failed: ${err}`);
                safeExit('which', 1, 'error');
            }
        })
    );

registerPluginCommand({ program });

// Helper to bootstrap a minimal agent for non-interactive commands
async function bootstrapAgentFromGlobalOpts(options: {
    mode: BootstrapAgentMode;
    modelOverride?: string;
}) {
    const { mode, modelOverride } = options;
    const isHeadlessRun = mode === 'headless-run';
    await ensureDextoApiKeyBootstrap();
    await ensureImageImporterConfigured();
    const globalOpts = program.opts();
    const effectiveModel = modelOverride ?? globalOpts.model;
    let inferredProvider: LLMProvider | undefined;
    let inferredApiKey: string | undefined;

    // Non-interactive subcommands bypass the main mode action, so replicate
    // model -> provider/apiKey inference here.
    if (effectiveModel) {
        if (effectiveModel.includes('/')) {
            throw new Error(
                `Model '${effectiveModel}' looks like an OpenRouter-format ID (provider/model). Please set provider/model explicitly in agent config for this command.`
            );
        }

        inferredProvider = getProviderFromModel(effectiveModel);
        const apiKey = resolveApiKeyForProvider(inferredProvider);
        if (!apiKey) {
            const envVar = getPrimaryApiKeyEnvVar(inferredProvider);
            throw new Error(
                `Missing API key for provider '${inferredProvider}' - please set $${envVar}`
            );
        }

        inferredApiKey = apiKey;
    }

    const resolvedPath = await resolveAgentPath(globalOpts.agent, globalOpts.autoInstall !== false);
    const workspaceRoot = findDextoProjectRoot(process.cwd()) ?? process.cwd();
    const rawConfig = await loadAgentConfig(resolvedPath);
    const mergedConfig = applyCLIOverrides(rawConfig, {
        ...globalOpts,
        ...(modelOverride ? { model: modelOverride } : {}),
    });
    if (effectiveModel) {
        mergedConfig.llm.model = effectiveModel;
    }
    if (inferredProvider && inferredApiKey) {
        mergedConfig.llm.provider = inferredProvider;
        mergedConfig.llm.apiKey = inferredApiKey;
    }

    // Load image first to apply defaults and resolve DI services
    // Priority: CLI flag > Agent config > Environment variable > Default
    const imageName =
        globalOpts.image || // --image flag
        mergedConfig.image || // image field in agent config
        process.env.DEXTO_IMAGE || // DEXTO_IMAGE env var
        '@dexto/image-local'; // Default for convenience

    let image: DextoImage;
    try {
        image = await loadImage(imageName);
    } catch (err) {
        console.error(`❌ Failed to load image '${imageName}'`);
        if (err instanceof Error) {
            console.error(err.message);
        }
        console.error(`💡 Install it with: dexto image install ${imageName}`);
        safeExit('bootstrap', 1, 'image-load-failed');
    }

    const configWithImageDefaults = applyImageDefaults(mergedConfig, image.defaults);

    // Enrich config with per-agent paths BEFORE validation
    const enrichedConfig = enrichAgentConfig(configWithImageDefaults, resolvedPath, {
        // Headless run keeps output deterministic and noise-free.
        // Other non-interactive commands keep visible logs.
        logLevel: isHeadlessRun ? 'error' : 'info',
        workspaceRoot,
    });

    if (isHeadlessRun) {
        // Force silent transport in headless mode even when agent config defines logger settings.
        // `dexto run` owns stderr formatting and should be the only writer.
        enrichedConfig.logger = {
            level: 'error',
            transports: [{ type: 'silent' }],
        };
    }

    // Override approval config for non-interactive commands.
    // Headless operations default to auto-approve and disable elicitation to
    // avoid waiting for interactive approval handlers.
    enrichedConfig.permissions = {
        ...(enrichedConfig.permissions ?? {}),
        mode: 'auto-approve',
    };
    enrichedConfig.elicitation = {
        enabled: false,
        ...(enrichedConfig.elicitation?.timeout !== undefined && {
            timeout: enrichedConfig.elicitation.timeout,
        }),
    };

    const validatedConfig = AgentConfigSchema.parse(enrichedConfig);
    const services = await resolveServicesFromConfig(validatedConfig, image);
    const agent = new DextoAgent(
        toDextoAgentOptions({
            config: validatedConfig,
            services,
            image,
        })
    );
    await agent.start();
    await (await import('./utils/workspace.js')).applyWorkspaceToAgent(agent, workspaceRoot);

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

// 11) Runtime commands (`run`, `session`, `search`, `auth`, `billing`)
const runtimeCommandContext = {
    program,
    cliVersion,
    bootstrapAgentFromGlobalOpts,
};
registerRunCommand(runtimeCommandContext);
registerSessionCommand(runtimeCommandContext);
registerSearchCommand(runtimeCommandContext);
registerAuthCommand(runtimeCommandContext);
registerBillingCommand(runtimeCommandContext);
registerMcpCommand({ program });

// 13) Main dexto CLI - Interactive (CLI) or run in other modes (--mode web/server/mcp)
program
    // Main customer facing description
    .description(
        'Dexto CLI - AI-powered assistant with session management.\n\n' +
            'Basic Usage:\n' +
            '  dexto or dexto --mode cli  Start interactive CLI (default)\n' +
            '  dexto --mode web         Start web UI\n' +
            '  dexto --prompt "query"   Start interactive CLI and run the prompt\n' +
            '  dexto run "query"        Run one-off headless task\n\n' +
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
            'Ink CLI Modes:\n' +
            '  dexto --bypass-permissions  Start in bypass permissions mode (skip approval prompts)\n\n' +
            'Advanced Modes:\n' +
            '  dexto --mode server      Run as API server\n' +
            '  dexto --mode mcp         Run as MCP server\n\n' +
            'Docs: https://docs.dexto.ai'
    )
    .action(
        withAnalytics(
            'main',
            async () => {
                await ensureDextoApiKeyBootstrap();
                await ensureImageImporterConfigured();
                ensureLlmRegistryAutoUpdateStarted();

                // ——— ENV CHECK (optional) ———
                if (!existsSync('.env')) {
                    logger.debug(
                        'WARNING: .env file not found; copy .env.example and set your API keys.'
                    );
                }

                const opts = program.opts();
                const workspaceRoot = findDextoProjectRoot(process.cwd()) ?? process.cwd();

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

                const initialPrompt = opts.prompt !== undefined ? String(opts.prompt) : undefined;

                if (initialPrompt !== undefined && initialPrompt.trim() === '') {
                    console.error(
                        '❌ Prompt cannot be empty. Provide a non-empty prompt with -p/--prompt.'
                    );
                    safeExit('main', 1, 'empty-prompt');
                }

                // Note: Agent selection must be passed via -a/--agent. We no longer interpret
                // the first positional argument as an agent name to avoid ambiguity with prompts.

                // ——— FORCE CLI MODE FOR PROMPT/SESSION FLAGS ———
                // If a prompt or session flag was provided, force CLI mode.
                const modeForcedByChatFlags = Boolean(
                    initialPrompt || opts.continue || opts.resume || opts.cloudAgent
                );
                if (modeForcedByChatFlags && opts.mode !== 'cli') {
                    console.error(
                        `ℹ️  Forcing CLI mode due to --prompt/--continue/--resume/--cloud-agent.`
                    );
                    console.error(`   Original mode: ${opts.mode} → Overridden to: cli`);
                    opts.mode = 'cli';
                }

                // The interactive CLI requires a TTY (Ink uses stdin for keypress input).
                if (opts.mode === 'cli' && !process.stdin.isTTY) {
                    console.error('❌ Interactive CLI requires a TTY.');
                    console.error(
                        '💡 For non-interactive runs, use `dexto run "<prompt>"`, or use --mode server for automation.'
                    );
                    safeExit('main', 1, 'no-tty');
                }

                if (opts.cloudAgent) {
                    if (opts.agent) {
                        console.error(
                            '❌ `--agent` and `--cloud-agent` are mutually exclusive. Use one chat target at a time.'
                        );
                        safeExit('main', 1, 'cloud-agent-conflict');
                    }

                    try {
                        const { startCloudChatCli } = await import('./cli/cloud-chat.js');
                        await startCloudChatCli({
                            cloudAgentId: String(opts.cloudAgent),
                            ...(initialPrompt ? { initialPrompt } : {}),
                            ...(opts.resume ? { resume: String(opts.resume) } : {}),
                            ...(opts.continue ? { continueMostRecent: true } : {}),
                        });
                        safeExit('main', 0);
                    } catch (err) {
                        if (err instanceof ExitSignal) throw err;
                        console.error(`❌ Cloud chat failed: ${err}`);
                        safeExit('main', 1, 'cloud-chat-error');
                    }
                }

                // ——— Infer provider & API key from model ———
                if (opts.model) {
                    if (opts.model.includes('/')) {
                        console.error(
                            `❌ Model '${opts.model}' looks like an OpenRouter-format ID (provider/model).`
                        );
                        console.error(
                            `   This is ambiguous for --model inference. Please also pass --provider (e.g. --provider dexto-nova or --provider openrouter).`
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
                let image: DextoImage;
                let imageName: string;

                // Determine validation mode early - used throughout config loading and agent creation
                // Use relaxed validation for interactive modes (web/cli) where users can configure later
                // Use strict validation for non-interactive modes (server/mcp) that need full config upfront
                let isInteractiveMode = opts.mode === 'web' || opts.mode === 'cli';
                const shouldCheckSetupState =
                    !opts.skipSetup && !(opts.agent && isPath(opts.agent));
                let setupRequired = false;

                if (shouldCheckSetupState) {
                    const { requiresSetup } = await import('./cli/utils/setup-utils.js');
                    setupRequired = await requiresSetup();
                }

                const canRunInteractiveSetup = isInteractiveMode && opts.interactive !== false;

                if (setupRequired && !canRunInteractiveSetup) {
                    console.error('❌ Setup required before starting in this mode.');
                    console.error(
                        '💡 Run `dexto setup` first, or use --skip-setup to bypass global setup.'
                    );
                    safeExit('main', 1, 'setup-required-non-interactive');
                }

                const shouldRunSetupBeforeStartup =
                    setupRequired && canRunInteractiveSetup && !opts.provider && !opts.model;

                if (shouldRunSetupBeforeStartup) {
                    const { handleSetupCommand } = await import('./cli/commands/setup.js');
                    await handleSetupCommand({
                        interactive: true,
                        defaultMode: opts.mode === 'cli' ? 'cli' : undefined,
                    });

                    if (!explicitModeProvided && !modeForcedByChatFlags) {
                        const preferences = await loadGlobalPreferences();
                        if (preferences.defaults.defaultMode) {
                            opts.mode = preferences.defaults.defaultMode;
                        }
                        isInteractiveMode = opts.mode === 'web' || opts.mode === 'cli';
                    }
                }

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

                        // Resolve the configured agent after setup has been established for
                        // interactive startup. This keeps provider selection generic instead of
                        // letting bundled agent defaults decide first-run behavior.
                        resolvedPath = await resolveAgentPath(
                            opts.agent,
                            opts.autoInstall !== false
                        );

                        if (opts.interactive !== false) {
                            const {
                                getBundledSyncTargetForAgentPath,
                                shouldPromptForSync,
                                handleSyncAgentsCommand,
                            } = await import('./cli/commands/agents/sync.js');
                            const syncTarget = getBundledSyncTargetForAgentPath(resolvedPath);

                            if (syncTarget && (await shouldPromptForSync(resolvedPath))) {
                                const shouldSync = await p.confirm({
                                    message: `Bundled agent updates available for '${syncTarget.agentId}'. Sync now?`,
                                    initialValue: true,
                                });

                                if (!p.isCancel(shouldSync) && shouldSync) {
                                    await handleSyncAgentsCommand({
                                        force: true,
                                        quiet: true,
                                        agentIds: [syncTarget.agentId],
                                    });
                                }
                            }
                        }
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
                    let hasCompletedSetup = false;

                    if (globalPreferencesExist()) {
                        try {
                            preferences = await loadGlobalPreferences();
                            hasCompletedSetup = preferences.setup.completed;
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
                                await handleLoginCommand();

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
                                hasCompletedSetup = preferences.setup.completed;
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
                    mergedConfig = applyStartupLLMFallback(mergedConfig, {
                        hasCompletedSetup,
                        hasExplicitProviderOverride: Boolean(opts.provider),
                        hasExplicitModelOverride: Boolean(opts.model),
                        hasExplicitApiKeyOverride: Boolean(opts.apiKey),
                    });

                    if (
                        hasCompletedSetup &&
                        preferences?.llm?.provider &&
                        preferences?.llm?.model
                    ) {
                        mergedConfig = applyUserPreferences(mergedConfig, preferences);
                        logger.debug(`Applied user preferences to ${agentId}`, {
                            provider: preferences.llm.provider,
                            model: preferences.llm.model,
                        });
                    }

                    // Clean up null values from config (can happen from YAML files with explicit nulls)
                    // This prevents "Expected string, received null" errors for optional fields
                    const cleanedConfig = cleanNullValues(mergedConfig);

                    // Load image first to apply defaults and resolve DI services
                    // Priority: CLI flag > Agent config > Environment variable > Default
                    imageName =
                        opts.image || // --image flag
                        cleanedConfig.image || // image field in agent config
                        process.env.DEXTO_IMAGE || // DEXTO_IMAGE env var
                        '@dexto/image-local'; // Default for convenience

                    try {
                        image = await loadImage(imageName);
                        logger.debug(`Loaded image: ${imageName}`);
                    } catch (err) {
                        console.error(`❌ Failed to load image '${imageName}'`);
                        if (err instanceof Error) {
                            console.error(err.message);
                            logger.debug(`Image load error: ${err.message}`);
                        }
                        console.error(`💡 Install it with: dexto image install ${imageName}`);
                        safeExit('main', 1, 'image-load-failed');
                    }

                    const configWithImageDefaults = applyImageDefaults(
                        cleanedConfig,
                        image.defaults
                    );

                    // Enrich config with per-agent paths BEFORE validation
                    // Enrichment adds filesystem paths to storage (schema has in-memory defaults)
                    // Interactive CLI mode: only log to file (console would interfere with chat UI)
                    const isInteractiveCli = opts.mode === 'cli';
                    const enrichedConfig = enrichAgentConfig(
                        configWithImageDefaults,
                        resolvedPath,
                        {
                            isInteractiveCli,
                            logLevel: 'info', // CLI uses info-level logging for visibility
                            workspaceRoot,
                        }
                    );

                    // Validate enriched config + preflight credentials.
                    // - Interactive modes (web/cli): warn and continue when credentials are missing
                    // - Headless modes (server/mcp): treat missing credentials as errors
                    const validationResult = await validateAgentConfig(
                        enrichedConfig,
                        opts.interactive !== false,
                        {
                            credentialPolicy: isInteractiveMode ? 'warn' : 'error',
                            agentPath: resolvedPath,
                        }
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
                        validatedConfig.image !== imageName
                    ) {
                        console.error(
                            `❌ Config specifies image '${validatedConfig.image}' but '${imageName}' was loaded instead`
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
                    validatedConfig.permissions.mode === 'manual' ||
                    validatedConfig.elicitation.enabled;

                if (needsHandler) {
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
                            '💡 Run `dexto --auto-approve` or configure your agent to skip approvals when running non-interactively.'
                        );
                        console.error(
                            '   permissions.mode: auto-approve (or auto-deny if you want to deny certain tools)'
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
                    const { createFileSessionLoggerFactory } = await import(
                        './utils/session-logger-factory.js'
                    );
                    const sessionLoggerFactory = createFileSessionLoggerFactory();

                    const mcpAuthProviderFactory =
                        opts.mode === 'cli'
                            ? (
                                  await import('./cli/mcp/oauth-factory.js')
                              ).createMcpAuthProviderFactory({
                                  logger,
                              })
                            : null;

                    const services = await resolveServicesFromConfig(validatedConfig, image);
                    agent = new DextoAgent(
                        toDextoAgentOptions({
                            config: validatedConfig,
                            services,
                            image,
                            overrides: {
                                sessionLoggerFactory,
                                mcpAuthProviderFactory,
                            },
                        })
                    );

                    // Start the agent (initialize async services)
                    // - web/server modes: initializeHonoApi will set approval handler and start the agent
                    // - cli mode: handles its own approval setup in the case block
                    // - other modes: start immediately (no approval support)
                    if (opts.mode !== 'web' && opts.mode !== 'server' && opts.mode !== 'cli') {
                        await agent.start();
                        await (
                            await import('./utils/workspace.js')
                        ).applyWorkspaceToAgent(agent, workspaceRoot);
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

                const { dispatchMainMode } = await import('./cli/modes/dispatch.js');
                const mainModeOpts: MainModeOptions = {
                    mode: opts.mode,
                    port: opts.port,
                    resume: opts.resume,
                    continue: opts.continue,
                    bypassPermissions: opts.bypassPermissions,
                };
                await dispatchMainMode({
                    agent,
                    opts: mainModeOpts,
                    workspaceRoot,
                    validatedConfig,
                    resolvedPath,
                    derivedAgentId,
                    initialPrompt,
                    getVersionCheckResult,
                });
            },
            { timeoutMs: 0 }
        )
    );

// 14) PARSE & EXECUTE
program.parseAsync(process.argv);
