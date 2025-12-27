// packages/cli/src/cli/commands/setup.ts

import chalk from 'chalk';
import { z } from 'zod';
import {
    getDefaultModelForProvider,
    LLM_PROVIDERS,
    LLM_REGISTRY,
    isValidProviderModel,
    getSupportedModels,
    acceptsAnyModel,
    supportsCustomModels,
    requiresApiKey,
} from '@dexto/core';
import { resolveApiKeyForProvider } from '@dexto/core';
import {
    createInitialPreferences,
    saveGlobalPreferences,
    loadGlobalPreferences,
    getGlobalPreferencesPath,
    updateGlobalPreferences,
    type CreatePreferencesOptions,
} from '@dexto/agent-management';
import { interactiveApiKeySetup, hasApiKeyConfigured } from '../utils/api-key-setup.js';
import {
    selectProvider,
    getProviderDisplayName,
    getProviderEnvVar,
    getProviderInfo,
    providerRequiresBaseURL,
    getDefaultModel,
} from '../utils/provider-setup.js';
import { requiresSetup } from '../utils/setup-utils.js';
import * as p from '@clack/prompts';
import { logger } from '@dexto/core';
import { capture } from '../../analytics/index.js';
import type { LLMProvider } from '@dexto/core';

// Zod schema for setup command validation
const SetupCommandSchema = z
    .object({
        provider: z
            .enum(LLM_PROVIDERS)
            .optional()
            .describe('AI provider identifier to use for LLM calls'),
        model: z
            .string()
            .min(1, 'Model name cannot be empty')
            .optional()
            .describe('Preferred model name for the selected provider'),
        defaultAgent: z
            .string()
            .min(1, 'Default agent name cannot be empty')
            .default('default-agent')
            .describe('Registry agent id to use when none is specified'),
        interactive: z.boolean().default(true).describe('Enable interactive prompts'),
        force: z
            .boolean()
            .default(false)
            .describe('Overwrite existing setup when already configured'),
        quickStart: z
            .boolean()
            .default(false)
            .describe('Use quick start with Google Gemini (recommended for new users)'),
    })
    .strict()
    .superRefine((data, ctx) => {
        // Validate model against provider when both are provided
        if (data.provider && data.model) {
            // Skip validation for providers that accept any model
            if (!acceptsAnyModel(data.provider) && !supportsCustomModels(data.provider)) {
                if (!isValidProviderModel(data.provider, data.model)) {
                    const supportedModels = getSupportedModels(data.provider);
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: ['model'],
                        message: `Model '${data.model}' is not supported by provider '${data.provider}'. Supported models: ${supportedModels.join(', ')}`,
                    });
                }
            }
        }
    });

export type CLISetupOptions = z.output<typeof SetupCommandSchema>;
export type CLISetupOptionsInput = z.input<typeof SetupCommandSchema>;

/**
 * Validate setup command options with comprehensive validation
 */
function validateSetupCommand(options: Partial<CLISetupOptionsInput>): CLISetupOptions {
    const validated = SetupCommandSchema.parse(options);

    // Business logic validation
    if (!validated.interactive && !validated.provider && !validated.quickStart) {
        throw new Error(
            'Provider required in non-interactive mode. Use --provider or --quick-start option.'
        );
    }

    return validated;
}

/**
 * Main setup command handler
 */
export async function handleSetupCommand(options: Partial<CLISetupOptionsInput>): Promise<void> {
    const validated = validateSetupCommand(options);
    logger.debug(`Validated setup command options: ${JSON.stringify(validated, null, 2)}`);

    // Check if setup is already complete
    const needsSetup = await requiresSetup();

    if (!needsSetup && !validated.force) {
        if (!validated.interactive) {
            console.error(chalk.red('❌ Setup is already complete.'));
            console.error(
                chalk.dim('   Use --force to overwrite, or run interactively for options.')
            );
            process.exit(1);
        }

        // Interactive mode: show settings menu
        await showSettingsMenu();
        return;
    }

    // Handle quick start
    if (validated.quickStart) {
        await handleQuickStart();
        return;
    }

    // Handle interactive full setup
    if (validated.interactive && !validated.provider) {
        await handleInteractiveSetup(validated);
        return;
    }

    // Handle non-interactive setup with provided options
    await handleNonInteractiveSetup(validated);
}

/**
 * Quick start flow - uses Google Gemini with minimal prompts
 */
async function handleQuickStart(): Promise<void> {
    console.log(chalk.cyan('\n🚀 Quick Start with Google Gemini\n'));

    p.intro(chalk.cyan('Quick Setup'));

    const provider: LLMProvider = 'google';
    const model = getDefaultModelForProvider(provider) || 'gemini-2.5-pro';
    const apiKeyVar = getProviderEnvVar(provider);
    let apiKeySkipped = false;

    // Check if API key exists
    const hasKey = hasApiKeyConfigured(provider);

    if (!hasKey) {
        p.note(
            `Google Gemini is ${chalk.green('free')} to use!\n\n` +
                `We'll help you get an API key in just a few seconds.`,
            'Free AI Access'
        );

        const result = await interactiveApiKeySetup(provider, {
            exitOnCancel: false, // Don't exit - allow skipping
            model,
        });

        if (result.cancelled) {
            p.cancel('Setup cancelled');
            process.exit(0);
        }

        if (result.skipped || !result.success) {
            apiKeySkipped = true;
        }
    } else {
        p.log.success(`API key for ${getProviderDisplayName(provider)} already configured`);
    }

    // Ask about default mode
    const defaultMode = await selectDefaultMode();

    // Save preferences
    const preferencesOptions: CreatePreferencesOptions = {
        provider,
        model,
        defaultMode,
        setupCompleted: true,
        apiKeyPending: apiKeySkipped,
    };
    // Only include apiKeyVar if not skipped
    if (!apiKeySkipped) {
        preferencesOptions.apiKeyVar = apiKeyVar;
    }
    const preferences = createInitialPreferences(preferencesOptions);

    await saveGlobalPreferences(preferences);

    capture('dexto_setup', {
        provider,
        model,
        setupMode: 'interactive',
        setupVariant: 'quick-start',
        defaultMode,
        apiKeySkipped,
    });

    showSetupComplete(provider, model, defaultMode, apiKeySkipped);
}

/**
 * Full interactive setup flow
 */
async function handleInteractiveSetup(_options: CLISetupOptions): Promise<void> {
    console.log(chalk.cyan('\n🗿 Dexto Setup\n'));

    p.intro(chalk.cyan("Let's configure your AI agent"));

    // Show quick start option first
    const setupType = await p.select({
        message: 'How would you like to set up Dexto?',
        options: [
            {
                value: 'quick',
                label: `${chalk.green('●')} Quick Start`,
                hint: 'Google Gemini (free) - recommended for new users',
            },
            {
                value: 'custom',
                label: `${chalk.blue('●')} Custom Setup`,
                hint: 'Choose your provider (OpenAI, Anthropic, Ollama, etc.)',
            },
        ],
    });

    if (p.isCancel(setupType)) {
        p.cancel('Setup cancelled');
        process.exit(0);
    }

    if (setupType === 'quick') {
        await handleQuickStart();
        return;
    }

    // Custom setup - choose provider
    const provider = await selectProvider();
    const _providerInfo = getProviderInfo(provider); // Keep for future use (e.g., displaying API key URL)

    // Handle baseURL for providers that need it
    let baseURL: string | undefined;
    if (providerRequiresBaseURL(provider)) {
        baseURL = await promptForBaseURL(provider);
    }

    // Get model
    const model = await selectModel(provider);

    // API key setup - skip for providers that don't require API keys (Ollama, vLLM, etc.)
    const apiKeyVar = getProviderEnvVar(provider);
    const hasKey = hasApiKeyConfigured(provider);
    const needsApiKey = requiresApiKey(provider);
    let apiKeySkipped = false;

    if (needsApiKey && !hasKey) {
        const result = await interactiveApiKeySetup(provider, {
            exitOnCancel: false, // Don't exit - allow skipping
            model,
        });

        if (result.cancelled) {
            p.cancel('Setup cancelled');
            process.exit(0);
        }

        if (result.skipped || !result.success) {
            apiKeySkipped = true;
        }
    } else if (needsApiKey && hasKey) {
        p.log.success(`API key for ${getProviderDisplayName(provider)} already configured`);
    } else if (!needsApiKey) {
        p.log.info(`${getProviderDisplayName(provider)} does not require an API key`);
    }

    // Ask about default mode
    const defaultMode = await selectDefaultMode();

    // Save preferences
    const preferencesOptions: CreatePreferencesOptions = {
        provider,
        model,
        defaultMode,
        setupCompleted: true,
        apiKeyPending: apiKeySkipped,
    };
    // Only include apiKeyVar if not skipped and provider needs it
    if (needsApiKey && !apiKeySkipped) {
        preferencesOptions.apiKeyVar = apiKeyVar;
    }
    if (baseURL) {
        preferencesOptions.baseURL = baseURL;
    }
    const preferences = createInitialPreferences(preferencesOptions);

    await saveGlobalPreferences(preferences);

    capture('dexto_setup', {
        provider,
        model,
        setupMode: 'interactive',
        setupVariant: 'custom',
        defaultMode,
        hasBaseURL: Boolean(baseURL),
        apiKeySkipped,
    });

    showSetupComplete(provider, model, defaultMode, apiKeySkipped);
}

/**
 * Non-interactive setup with CLI options
 */
async function handleNonInteractiveSetup(options: CLISetupOptions): Promise<void> {
    const provider = options.provider!;
    const model = options.model || getDefaultModel(provider);

    if (!model) {
        console.error(chalk.red(`❌ Model is required for provider '${provider}'.`));
        console.error(chalk.dim(`   Use --model option to specify a model.`));
        process.exit(1);
    }

    const apiKeyVar = getProviderEnvVar(provider);
    const hadApiKeyBefore = Boolean(resolveApiKeyForProvider(provider));

    const preferences = createInitialPreferences({
        provider,
        model,
        apiKeyVar,
        defaultAgent: options.defaultAgent,
        setupCompleted: true,
    });

    await saveGlobalPreferences(preferences);

    capture('dexto_setup', {
        provider,
        model,
        hadApiKeyBefore,
        setupMode: 'non-interactive',
    });

    console.log(chalk.green('\n✨ Setup complete! Dexto is ready to use.\n'));
}

/**
 * Settings menu for users who already have setup complete
 */
async function showSettingsMenu(): Promise<void> {
    p.intro(chalk.cyan('⚙️  Dexto Settings'));

    // Load current preferences
    let currentPrefs;
    try {
        currentPrefs = await loadGlobalPreferences();
    } catch {
        currentPrefs = null;
    }

    // Show current configuration
    if (currentPrefs) {
        const currentConfig = [
            `Provider: ${chalk.cyan(getProviderDisplayName(currentPrefs.llm.provider))}`,
            `Model: ${chalk.cyan(currentPrefs.llm.model)}`,
            `Default Mode: ${chalk.cyan(currentPrefs.defaults.defaultMode)}`,
            ...(currentPrefs.llm.baseURL
                ? [`Base URL: ${chalk.cyan(currentPrefs.llm.baseURL)}`]
                : []),
        ].join('\n');

        p.note(currentConfig, 'Current Configuration');
    }

    const action = await p.select({
        message: 'What would you like to do?',
        options: [
            {
                value: 'provider',
                label: 'Change AI provider',
                hint: 'Switch to a different AI provider',
            },
            {
                value: 'model',
                label: 'Change model',
                hint: `Currently: ${currentPrefs?.llm.model || 'not set'}`,
            },
            {
                value: 'mode',
                label: 'Change default mode',
                hint: `Currently: ${currentPrefs?.defaults.defaultMode || 'web'}`,
            },
            {
                value: 'apikey',
                label: 'Update API key',
                hint: 'Re-enter your API key',
            },
            {
                value: 'reset',
                label: 'Reset to defaults',
                hint: 'Start fresh with a new configuration',
            },
            {
                value: 'file',
                label: 'View preferences file',
                hint: 'See where your settings are stored',
            },
            {
                value: 'exit',
                label: 'Exit',
                hint: 'Done making changes',
            },
        ],
    });

    if (p.isCancel(action) || action === 'exit') {
        p.outro('Settings unchanged');
        return;
    }

    switch (action) {
        case 'provider':
            await changeProvider();
            break;
        case 'model':
            await changeModel(currentPrefs?.llm.provider);
            break;
        case 'mode':
            await changeDefaultMode();
            break;
        case 'apikey':
            await updateApiKey(currentPrefs?.llm.provider);
            break;
        case 'reset':
            await resetSetup();
            break;
        case 'file':
            showPreferencesFilePath();
            break;
    }
}

/**
 * Change provider setting
 */
async function changeProvider(): Promise<void> {
    const provider = await selectProvider();
    const model = await selectModel(provider);
    const apiKeyVar = getProviderEnvVar(provider);

    // Check if API key is needed and exists
    const hasKey = hasApiKeyConfigured(provider);
    const needsApiKey = requiresApiKey(provider);
    let apiKeyConfigured = hasKey;

    if (needsApiKey && !hasKey) {
        const result = await interactiveApiKeySetup(provider, {
            exitOnCancel: false,
            model,
        });
        if (result.cancelled) {
            p.outro('Provider change cancelled');
            return;
        }
        apiKeyConfigured = result.success && !result.skipped;
    } else if (!needsApiKey) {
        p.log.info(`${getProviderDisplayName(provider)} does not require an API key`);
    }

    // Handle baseURL for providers that need it
    let baseURL: string | undefined;
    if (providerRequiresBaseURL(provider)) {
        baseURL = await promptForBaseURL(provider);
    }

    const llmUpdate: { provider: LLMProvider; model: string; apiKey?: string; baseURL?: string } = {
        provider,
        model,
    };
    // Only include apiKey if configured (either existing or just set up)
    if (needsApiKey && apiKeyConfigured) {
        llmUpdate.apiKey = `$${apiKeyVar}`;
    }
    if (baseURL) {
        llmUpdate.baseURL = baseURL;
    }

    await updateGlobalPreferences({ llm: llmUpdate });

    if (needsApiKey && !apiKeyConfigured) {
        p.outro(
            chalk.yellow(`✓ Switched to ${getProviderDisplayName(provider)} (API key pending)`)
        );
    } else {
        p.outro(
            chalk.green(`✓ Switched to ${getProviderDisplayName(provider)} with model ${model}`)
        );
    }
}

/**
 * Change model setting
 */
async function changeModel(currentProvider?: LLMProvider): Promise<void> {
    const provider = currentProvider || (await selectProvider());
    const model = await selectModel(provider);
    const apiKeyVar = getProviderEnvVar(provider);
    const needsApiKey = requiresApiKey(provider);

    const llmUpdate: { provider: LLMProvider; model: string; apiKey?: string } = {
        provider,
        model,
    };
    // Only include apiKey for providers that need it
    if (needsApiKey) {
        llmUpdate.apiKey = `$${apiKeyVar}`;
    }

    await updateGlobalPreferences({ llm: llmUpdate });

    p.outro(chalk.green(`✓ Model changed to ${model}`));
}

/**
 * Change default mode setting
 */
async function changeDefaultMode(): Promise<void> {
    const mode = await selectDefaultMode();

    await updateGlobalPreferences({
        defaults: { defaultMode: mode },
    });

    p.outro(chalk.green(`✓ Default mode changed to ${mode}`));
}

/**
 * Update API key for current provider
 */
async function updateApiKey(currentProvider?: LLMProvider): Promise<void> {
    const provider = currentProvider || (await selectProvider());

    // Handle providers that use non-API-key authentication
    if (provider === 'vertex') {
        p.note(
            `Google Vertex AI uses Application Default Credentials (ADC).\n\n` +
                `To authenticate:\n` +
                `  1. Install gcloud CLI: https://cloud.google.com/sdk/docs/install\n` +
                `  2. Run: gcloud auth application-default login\n` +
                `  3. Set GOOGLE_VERTEX_PROJECT environment variable`,
            'Google Cloud Authentication'
        );
        p.outro('');
        return;
    }

    if (provider === 'bedrock') {
        p.note(
            `Amazon Bedrock uses AWS credentials.\n\n` +
                `To authenticate, set these environment variables:\n` +
                `  • AWS_REGION (required)\n` +
                `  • AWS_ACCESS_KEY_ID (required)\n` +
                `  • AWS_SECRET_ACCESS_KEY (required)\n` +
                `  • AWS_SESSION_TOKEN (optional, for temporary credentials)`,
            'AWS Authentication'
        );
        p.outro('');
        return;
    }

    // For openai-compatible and litellm, API keys are optional but allowed
    // Show a note but still allow setting one
    if (provider === 'openai-compatible' || provider === 'litellm') {
        const wantsKey = await p.confirm({
            message: `API key is optional for ${getProviderDisplayName(provider)}. Set one anyway?`,
            initialValue: true,
        });

        if (p.isCancel(wantsKey) || !wantsKey) {
            p.outro('Skipped API key setup');
            return;
        }
    }

    const result = await interactiveApiKeySetup(provider, {
        exitOnCancel: false,
        skipVerification: false,
    });

    if (result.success) {
        p.outro(chalk.green(`✓ API key updated for ${getProviderDisplayName(provider)}`));
    } else {
        p.outro(chalk.yellow('API key update cancelled'));
    }
}

/**
 * Reset setup to start fresh
 */
async function resetSetup(): Promise<void> {
    const confirm = await p.confirm({
        message: 'This will erase your current configuration. Continue?',
        initialValue: false,
    });

    if (p.isCancel(confirm) || !confirm) {
        p.outro('Reset cancelled');
        return;
    }

    // Run full setup
    await handleInteractiveSetup({
        interactive: true,
        force: true,
        defaultAgent: 'default-agent',
        quickStart: false,
    });
}

/**
 * Show preferences file path
 */
function showPreferencesFilePath(): void {
    const prefsPath = getGlobalPreferencesPath();

    p.note(
        [
            `Your preferences are stored at:`,
            ``,
            `  ${chalk.cyan(prefsPath)}`,
            ``,
            `You can edit this file directly with any text editor.`,
            `Changes take effect on the next run of dexto.`,
            ``,
            chalk.dim('Example commands:'),
            chalk.dim(`  code ${prefsPath}     # Open in VS Code`),
            chalk.dim(`  nano ${prefsPath}     # Edit in terminal`),
            chalk.dim(`  cat ${prefsPath}      # View contents`),
        ].join('\n'),
        'Preferences File Location'
    );

    p.outro('');
}

/**
 * Select default mode interactively
 */
async function selectDefaultMode(): Promise<
    'cli' | 'web' | 'server' | 'discord' | 'telegram' | 'mcp'
> {
    const mode = await p.select({
        message: 'How do you want to use Dexto by default?',
        options: [
            {
                value: 'web' as const,
                label: `${chalk.blue('●')} Web UI`,
                hint: 'Opens in browser at localhost:3000 (recommended)',
            },
            {
                value: 'cli' as const,
                label: `${chalk.green('●')} Terminal CLI`,
                hint: 'Interactive command-line interface',
            },
            {
                value: 'server' as const,
                label: `${chalk.yellow('●')} API Server`,
                hint: 'REST API for programmatic access',
            },
        ],
    });

    if (p.isCancel(mode)) {
        return 'web'; // Default
    }

    return mode;
}

/**
 * Select model interactively
 */
async function selectModel(provider: LLMProvider): Promise<string> {
    const providerInfo = LLM_REGISTRY[provider];

    // For providers with a fixed model list
    if (providerInfo?.models && providerInfo.models.length > 0) {
        const options = providerInfo.models.map((m) => {
            const option: { value: string; label: string; hint?: string } = {
                value: m.name,
                label: m.displayName || m.name,
            };
            if (m.default) {
                option.hint = '(default)';
            }
            return option;
        });

        const selected = await p.select({
            message: `Select a model for ${getProviderDisplayName(provider)}`,
            options,
            initialValue: providerInfo.models.find((m) => m.default)?.name,
        });

        if (p.isCancel(selected)) {
            p.cancel('Setup cancelled');
            process.exit(0);
        }

        return selected as string;
    }

    // For providers that accept any model (openai-compatible, openrouter, etc.)
    const modelInput = await p.text({
        message: `Enter model name for ${getProviderDisplayName(provider)}`,
        placeholder:
            provider === 'openrouter' ? 'e.g., anthropic/claude-3.5-sonnet' : 'e.g., llama-3-70b',
        validate: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Model name is required';
            }
            return undefined;
        },
    });

    if (p.isCancel(modelInput)) {
        p.cancel('Setup cancelled');
        process.exit(0);
    }

    return modelInput.trim();
}

/**
 * Prompt for base URL for custom endpoints
 */
async function promptForBaseURL(provider: LLMProvider): Promise<string> {
    const placeholder =
        provider === 'openai-compatible'
            ? 'http://localhost:11434/v1'
            : provider === 'litellm'
              ? 'http://localhost:4000'
              : 'https://your-api-endpoint.com/v1';

    const baseURL = await p.text({
        message: `Enter base URL for ${getProviderDisplayName(provider)}`,
        placeholder,
        validate: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Base URL is required for this provider';
            }
            try {
                new URL(value.trim());
            } catch {
                return 'Please enter a valid URL';
            }
            return undefined;
        },
    });

    if (p.isCancel(baseURL)) {
        p.cancel('Setup cancelled');
        process.exit(0);
    }

    return baseURL.trim();
}

/**
 * Show setup complete message
 */
function showSetupComplete(
    provider: LLMProvider,
    model: string,
    defaultMode: string,
    apiKeySkipped: boolean = false
): void {
    const modeCommand = defaultMode === 'web' ? 'dexto' : `dexto --mode ${defaultMode}`;

    if (apiKeySkipped) {
        console.log(chalk.yellow('\n⚠️  Setup complete (API key pending)\n'));
    } else {
        console.log(chalk.green('\n✨ Setup complete! Dexto is ready to use.\n'));
    }

    const summary = [
        `${chalk.bold('Configuration:')}`,
        `  Provider: ${chalk.cyan(getProviderDisplayName(provider))}`,
        `  Model: ${chalk.cyan(model)}`,
        `  Mode: ${chalk.cyan(defaultMode)}`,
        ...(apiKeySkipped
            ? [
                  `  API Key: ${chalk.yellow('Not configured')}`,
                  ``,
                  `${chalk.bold('To complete setup:')}`,
                  `  Run ${chalk.cyan('dexto setup')} to add your API key`,
                  `  Or set ${chalk.cyan(getProviderEnvVar(provider))} in your environment`,
              ]
            : []),
        ``,
        `${chalk.bold('Next steps:')}`,
        `  Run ${chalk.cyan(modeCommand)} to start`,
        `  Run ${chalk.cyan('dexto setup')} to change settings`,
        `  Run ${chalk.cyan('dexto --help')} for more options`,
    ].join('\n');

    console.log(summary);
    console.log('');
}
