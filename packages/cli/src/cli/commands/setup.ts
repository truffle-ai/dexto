// packages/cli/src/cli/commands/setup.ts

import chalk from 'chalk';
import { z } from 'zod';
import open from 'open';
import {
    acceptsAnyModel,
    getDefaultModelForProvider,
    getCuratedModelsForProvider,
    getReasoningProfile,
    getSupportedModels,
    LLM_PROVIDERS,
    LLM_REGISTRY,
    logger,
    isValidProviderModel,
    supportsCustomModels,
    requiresApiKey,
    resolveApiKeyForProvider,
} from '@dexto/core';
import {
    createInitialPreferences,
    saveGlobalPreferences,
    loadGlobalPreferences,
    getGlobalPreferencesPath,
    updateGlobalPreferences,
    setActiveModel,
    isDextoAuthEnabled,
    loadCustomModels,
    saveCustomModel,
    deleteCustomModel,
    globalPreferencesExist,
    type CustomModel,
    type CreatePreferencesOptions,
} from '@dexto/agent-management';
import { interactiveApiKeySetup, hasApiKeyConfigured } from '../utils/api-key-setup.js';
import {
    selectProvider,
    getProviderDisplayName,
    getProviderEnvVar,
    providerRequiresBaseURL,
    getDefaultModel,
} from '../utils/provider-setup.js';
import {
    setupLocalModels,
    setupOllamaModels,
    hasSelectedModel,
    getModelFromResult,
} from '../utils/local-model-setup.js';
import { requiresSetup } from '../utils/setup-utils.js';
import { canUseDextoProvider } from '../utils/dexto-setup.js';
import { handleAutoLogin } from './auth/login.js';
import { loadAuth, getDextoApiClient } from '../auth/index.js';
import { DEXTO_CREDITS_URL } from '../auth/constants.js';
import * as p from '@clack/prompts';
import { capture } from '../../analytics/index.js';
import type { LLMProvider, ReasoningVariant } from '@dexto/core';

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
            .default('coding-agent')
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

const REASONING_VARIANT_HINTS: Readonly<Record<string, string>> = {
    disabled: 'Disable reasoning (fastest)',
    none: 'Disable reasoning (fastest)',
    enabled: 'Enable provider default reasoning',
    minimal: 'Minimal reasoning',
    low: 'Light reasoning, faster responses',
    medium: 'Balanced reasoning',
    high: 'Thorough reasoning',
    max: 'Maximum reasoning within provider limits',
    xhigh: 'Extra high reasoning',
};

function toReasoningVariantLabel(variant: string, defaultVariant: string | undefined): string {
    const normalized = variant.toLowerCase();
    const withKnownCasing =
        normalized === 'xhigh'
            ? 'XHigh'
            : normalized === 'none'
              ? 'None'
              : normalized === 'disabled'
                ? 'Disabled'
                : normalized === 'enabled'
                  ? 'Enabled'
                  : normalized.charAt(0).toUpperCase() + normalized.slice(1);

    return variant === defaultVariant ? `${withKnownCasing} (Recommended)` : withKnownCasing;
}

function getReasoningVariantSelectOptions(
    variants: readonly ReasoningVariant[],
    defaultVariant: string | undefined
): {
    value: ReasoningVariant;
    label: string;
    hint: string;
}[] {
    return variants.map((variant) => ({
        value: variant,
        label: toReasoningVariantLabel(variant, defaultVariant),
        hint: REASONING_VARIANT_HINTS[variant] ?? 'Model/provider-native reasoning variant',
    }));
}

// ============================================================================
// Setup Wizard Types and Helpers
// ============================================================================

/**
 * Setup wizard step identifiers
 */
type SetupStep = 'setupType' | 'provider' | 'model' | 'reasoning' | 'apiKey' | 'mode' | 'complete';

/**
 * Setup wizard state - accumulates data as user progresses through steps
 * Note: Properties explicitly allow undefined for back navigation to clear values
 */
interface SetupWizardState {
    step: SetupStep;
    setupType?: 'quick' | 'custom' | undefined;
    provider?: LLMProvider | undefined;
    model?: string | undefined;
    baseURL?: string | undefined;
    reasoningPreset?: ReasoningVariant | undefined;
    apiKeySkipped?: boolean | undefined;
    defaultMode?: 'cli' | 'web' | 'server' | 'discord' | 'telegram' | 'mcp' | undefined;
    /** Quick start handles its own preferences saving */
    quickStartHandled?: boolean | undefined;
}

/**
 * Get the steps to display for the current provider and model.
 * - Local/Ollama providers skip the API Key step.
 * - Reasoning-capable models (o1, o3, codex, gpt-5.x) show the Reasoning step.
 */
function getWizardSteps(
    provider?: LLMProvider,
    model?: string
): Array<{ key: SetupStep; label: string }> {
    const isLocalProvider = provider === 'local' || provider === 'ollama';
    const showReasoningStep =
        provider !== undefined &&
        model !== undefined &&
        getReasoningProfile(provider, model).capable;

    if (isLocalProvider) {
        const steps: Array<{ key: SetupStep; label: string }> = [
            { key: 'provider', label: 'Provider' },
            { key: 'model', label: 'Model' },
        ];
        if (showReasoningStep) {
            steps.push({ key: 'reasoning', label: 'Reasoning' });
        }
        steps.push({ key: 'mode', label: 'Mode' });
        return steps;
    }

    const steps: Array<{ key: SetupStep; label: string }> = [
        { key: 'provider', label: 'Provider' },
        { key: 'model', label: 'Model' },
    ];
    if (showReasoningStep) {
        steps.push({ key: 'reasoning', label: 'Reasoning' });
    }
    steps.push({ key: 'apiKey', label: 'API Key' });
    steps.push({ key: 'mode', label: 'Mode' });
    return steps;
}

/**
 * Display step progress indicator for the setup wizard
 */
function showStepProgress(currentStep: SetupStep, provider?: LLMProvider, model?: string): void {
    // Don't show progress for setupType (it's the entry point)
    if (currentStep === 'setupType' || currentStep === 'complete') {
        return;
    }

    const steps = getWizardSteps(provider, model);
    const currentIndex = steps.findIndex((s) => s.key === currentStep);

    if (currentIndex === -1) {
        return;
    }

    const progress = steps
        .map((step, i) => {
            if (i < currentIndex) return chalk.green(`✓ ${step.label}`);
            if (i === currentIndex) return chalk.cyan(`● ${step.label}`);
            return chalk.gray(`○ ${step.label}`);
        })
        .join('  ');

    console.log(`\n  ${progress}\n`);
}

// ============================================================================
// Setup Command Validation
// ============================================================================

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
                chalk.gray('   Use --force to overwrite, or run interactively for options.')
            );
            process.exit(1);
        }

        // Interactive mode: show settings menu
        await showSettingsMenu();
        return;
    }

    // Handle quick start
    if (validated.quickStart) {
        await handleQuickStart({ onCancel: 'exit' });
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
 * Quick start flow - pick a free provider with minimal prompts
 */
type QuickStartCancelBehavior = 'exit' | 'back';

interface QuickStartOptions {
    onCancel: QuickStartCancelBehavior;
}

async function handleQuickStart(
    options: QuickStartOptions = { onCancel: 'exit' }
): Promise<'completed' | 'cancelled'> {
    console.log(chalk.cyan('\n🚀 Quick Start\n'));

    p.intro(chalk.cyan('Quick Setup'));

    while (true) {
        // Let user pick from popular free providers
        const quickProvider = await p.select({
            message: 'Choose a provider',
            options: [
                {
                    value: 'google' as const,
                    label: `${chalk.green('●')} Google Gemini`,
                    hint: 'Free, 1M+ context (recommended)',
                },
                {
                    value: 'groq' as const,
                    label: `${chalk.green('●')} Groq`,
                    hint: 'Free, ultra-fast',
                },
                {
                    value: 'openrouter' as const,
                    label: `${chalk.green('●')} OpenRouter (Free)`,
                    hint: 'Use free-tier models via OpenRouter',
                },
                {
                    value: 'local' as const,
                    label: `${chalk.cyan('●')} Local Models`,
                    hint: 'Free, private, runs on your machine',
                },
                { value: '_back' as const, label: chalk.gray('← Back'), hint: 'Return' },
            ],
        });

        if (p.isCancel(quickProvider) || quickProvider === '_back') {
            if (options.onCancel === 'exit') {
                p.cancel('Setup cancelled');
            }
            return 'cancelled';
        }

        // Handle local models with dedicated setup flow
        if (quickProvider === 'local') {
            const localResult = await setupLocalModels();
            if (!hasSelectedModel(localResult)) {
                if (options.onCancel === 'exit') {
                    p.cancel('Setup cancelled');
                    return 'cancelled';
                }
                continue;
            }
            const model = getModelFromResult(localResult);

            // CLI mode confirmation for local
            const useCli = await p.confirm({
                message: 'Start in Terminal mode? (You can change this later)',
                initialValue: true,
            });

            if (p.isCancel(useCli)) {
                if (options.onCancel === 'exit') {
                    p.cancel('Setup cancelled');
                    return 'cancelled';
                }
                continue;
            }

            const defaultMode = useCli ? 'cli' : await selectDefaultMode();
            if (defaultMode === null) {
                if (options.onCancel === 'exit') {
                    p.cancel('Setup cancelled');
                    return 'cancelled';
                }
                continue;
            }

            // Sync the active model for local provider
            await setActiveModel(model);

            const preferences = createInitialPreferences({
                provider: 'local',
                model,
                defaultMode,
                setupCompleted: true,
                apiKeyPending: false,
            });

            await saveGlobalPreferences(preferences);

            capture('dexto_setup', {
                provider: 'local',
                model,
                setupMode: 'interactive',
                setupVariant: 'quick-start',
                defaultMode,
                apiKeySkipped: false,
            });

            await showSetupComplete('local', model, defaultMode, false);
            return 'completed';
        }

        // Cloud provider flow (google, groq, openrouter)
        const provider: LLMProvider = quickProvider;
        let model: string;
        if (provider === 'openrouter') {
            const selected = await p.select({
                message: 'Select a model for OpenRouter',
                options: [
                    {
                        value: 'openrouter/free' as const,
                        label: 'OpenRouter Free Models',
                        hint: 'Free-tier access via OpenRouter',
                    },
                    {
                        value: 'custom' as const,
                        label: 'Enter a model ID',
                        hint: 'e.g., anthropic/claude-3.5-sonnet',
                    },
                    { value: '_back' as const, label: chalk.gray('← Back'), hint: 'Return' },
                ],
            });

            if (p.isCancel(selected) || selected === '_back') {
                if (options.onCancel === 'exit') {
                    p.cancel('Setup cancelled');
                    return 'cancelled';
                }
                continue;
            }

            if (selected === 'openrouter/free') {
                model = 'openrouter/free';
            } else {
                const modelInput = await p.text({
                    message: 'Enter model name for OpenRouter',
                    placeholder: 'e.g., anthropic/claude-3.5-sonnet',
                    validate: (value) => {
                        const trimmed = typeof value === 'string' ? value.trim() : '';
                        if (!trimmed) return 'Model name is required';
                        return undefined;
                    },
                });

                if (p.isCancel(modelInput)) {
                    if (options.onCancel === 'exit') {
                        p.cancel('Setup cancelled');
                        return 'cancelled';
                    }
                    continue;
                }

                model = modelInput.trim();
            }
        } else {
            model =
                getDefaultModelForProvider(provider) ||
                (provider === 'google' ? 'gemini-2.5-pro' : 'llama-3.3-70b-versatile');
        }
        const apiKeyVar = getProviderEnvVar(provider);
        let apiKeySkipped = false;

        // Check if API key exists
        const hasKey = hasApiKeyConfigured(provider);

        if (!hasKey) {
            const providerName = getProviderDisplayName(provider);
            p.note(
                `${providerName} is ${chalk.green('free')} to use!\n\n` +
                    `We'll help you get an API key in just a few seconds.`,
                'Free AI Access'
            );

            const result = await interactiveApiKeySetup(provider, {
                exitOnCancel: false, // Don't exit - allow skipping
                model,
            });

            if (result.cancelled) {
                if (options.onCancel === 'exit') {
                    p.cancel('Setup cancelled');
                    return 'cancelled';
                }
                continue;
            }

            if (result.skipped || !result.success) {
                apiKeySkipped = true;
            }
        } else {
            p.log.success(`API key for ${getProviderDisplayName(provider)} already configured`);
        }

        // CLI mode confirmation
        const useCli = await p.confirm({
            message: 'Start in Terminal mode? (You can change this later)',
            initialValue: true,
        });

        if (p.isCancel(useCli)) {
            if (options.onCancel === 'exit') {
                p.cancel('Setup cancelled');
                return 'cancelled';
            }
            continue;
        }

        const defaultMode = useCli ? 'cli' : await selectDefaultMode();

        // Handle cancellation
        if (defaultMode === null) {
            if (options.onCancel === 'exit') {
                p.cancel('Setup cancelled');
                return 'cancelled';
            }
            continue;
        }

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

        await showSetupComplete(provider, model, defaultMode, apiKeySkipped);
        return 'completed';
    }
}

/**
 * Dexto setup flow - login if needed, select model, save preferences
 *
 * Config storage:
 * - provider: 'dexto-nova' (the gateway provider)
 * - model: OpenRouter-style ID (e.g., 'anthropic/claude-haiku-4.5')
 *
 * Runtime handles routing requests through the Dexto gateway to the underlying provider.
 */
async function handleDextoProviderSetup(
    options: { exitOnCancel?: boolean } = {}
): Promise<boolean> {
    const exitOnCancel = options.exitOnCancel ?? true;
    const abort = (message: string, exitCode: number = 0): false => {
        p.cancel(message);
        if (exitOnCancel) {
            process.exit(exitCode);
        }
        return false;
    };

    console.log(chalk.magenta('\n★ Dexto Nova Setup\n'));

    // Check if user already has DEXTO_API_KEY
    const hasKey = await canUseDextoProvider();

    if (!hasKey) {
        p.note(
            `Dexto gives you instant access to ${chalk.cyan('all AI models')} with a single account.\n\n` +
                `We'll guide you through login. Browser callback is used when available, otherwise device code flow.`,
            'Login Required'
        );

        const shouldLogin = await p.confirm({
            message: 'Continue with Dexto login?',
            initialValue: true,
        });

        if (p.isCancel(shouldLogin) || !shouldLogin) {
            return abort('Setup cancelled');
        }

        try {
            await handleAutoLogin();
            // Verify key was actually provisioned (provisionKeys silently catches errors)
            if (!(await canUseDextoProvider())) {
                p.log.error(
                    'API key provisioning failed. Please try again or use `dexto setup` with a different provider.'
                );
                return abort('Setup cancelled', 1);
            }
            p.log.success('Login successful! Continuing with setup...');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            p.log.error(`Login failed: ${errorMessage}`);
            return abort('Setup cancelled - login required for Dexto', 1);
        }
    } else {
        const auth = await loadAuth();
        const userLabel = auth?.email || auth?.userId || 'unknown';
        p.log.success(`Logged in to Dexto as: ${userLabel}`);
    }

    const balance = await getCreditsBalance();
    if (balance !== null) {
        p.note(`$${balance.toFixed(2)} remaining`, 'Dexto Nova balance');
    }

    const shouldOpenCredits = await p.confirm({
        message: 'Want to buy or top up Dexto Nova credits now?',
        initialValue: false,
    });

    if (p.isCancel(shouldOpenCredits)) {
        return abort('Setup cancelled');
    }

    if (shouldOpenCredits) {
        await openCreditsPage();

        const continueSetup = await p.confirm({
            message: 'Continue choosing a model?',
            initialValue: true,
        });

        if (p.isCancel(continueSetup) || !continueSetup) {
            return abort('Setup cancelled');
        }
    }

    // Model selection - show popular models in OpenRouter format
    // NOTE: This list is intentionally hardcoded (not from registry) to include
    // curated hints for onboarding UX. Keep model IDs in sync with:
    // packages/core/src/llm/registry/index.ts (LLM_REGISTRY['dexto-nova'].models)
    const model = await p.select({
        message: 'Select a model to start with',
        options: [
            // Claude models (Anthropic via Dexto gateway)
            {
                value: 'anthropic/claude-haiku-4.5',
                label: 'Claude Haiku 4.5',
                hint: 'Fast & affordable (recommended)',
            },
            {
                value: 'anthropic/claude-sonnet-4.5',
                label: 'Claude Sonnet 4.5',
                hint: 'Balanced performance and cost',
            },
            {
                value: 'anthropic/claude-opus-4.5',
                label: 'Claude Opus 4.5',
                hint: 'Most capable Claude model',
            },
            // OpenAI models (via Dexto gateway)
            {
                value: 'openai/gpt-5.2',
                label: 'GPT-5.2',
                hint: 'OpenAI flagship model',
            },
            {
                value: 'openai/gpt-5.2-codex',
                label: 'GPT-5.2 Codex',
                hint: 'Optimized for coding',
            },
            // Google models (via Dexto gateway)
            {
                value: 'google/gemini-3-pro-preview',
                label: 'Gemini 3 Pro',
                hint: 'Google flagship model',
            },
            {
                value: 'google/gemini-3-flash-preview',
                label: 'Gemini 3 Flash',
                hint: 'Fast and efficient',
            },
            // Free models (via Dexto gateway)
            {
                value: 'qwen/qwen3-coder:free',
                label: 'Qwen3 Coder (Free)',
                hint: 'Free coding model, 262k context',
            },
            {
                value: 'deepseek/deepseek-r1-0528:free',
                label: 'DeepSeek R1 (Free)',
                hint: 'Free reasoning model, 163k context',
            },
            // Other models (via Dexto gateway)
            {
                value: 'z-ai/glm-4.7',
                label: 'GLM 4.7',
                hint: 'Zhipu AI flagship model',
            },
            {
                value: 'minimax/minimax-m2.1',
                label: 'Minimax M2.1',
                hint: 'Fast model with 196k context',
            },
            {
                value: 'moonshotai/kimi-k2.5',
                label: 'Kimi K2.5',
                hint: 'Multimodal coding model, 262k context',
            },
        ],
    });

    if (p.isCancel(model)) {
        return abort('Setup cancelled');
    }

    // Dexto setup always uses 'dexto-nova' provider with OpenRouter model IDs
    const provider: LLMProvider = 'dexto-nova';

    // Cast model to string (prompts library typing)
    const selectedModel = model as string;

    p.log.info(`${chalk.dim('Tip:')} You can switch models anytime with ${chalk.cyan('/model')}`);

    // Ask about default mode
    const defaultMode = await selectDefaultMode();

    if (defaultMode === null) {
        return abort('Setup cancelled');
    }

    // Save preferences with explicit dexto-nova provider and OpenRouter model ID
    const preferences = createInitialPreferences({
        provider,
        model: selectedModel,
        defaultMode,
        setupCompleted: true,
        apiKeyPending: false,
        apiKeyVar: 'DEXTO_API_KEY',
    });

    await saveGlobalPreferences(preferences);

    capture('dexto_setup', {
        provider,
        model: selectedModel,
        setupMode: 'interactive',
        setupVariant: 'dexto-nova',
        defaultMode,
    });

    await showSetupComplete(provider, selectedModel, defaultMode, false);
    return true;
}

async function openCreditsPage(): Promise<void> {
    try {
        await open(DEXTO_CREDITS_URL);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        p.log.warn(`Unable to open browser: ${errorMessage}`);
        p.log.info(`Open this link to buy credits: ${DEXTO_CREDITS_URL}`);
    }
}

async function getCreditsBalance(): Promise<number | null> {
    try {
        const auth = await loadAuth();
        if (!auth?.dextoApiKey) return null;
        const apiClient = getDextoApiClient();
        const usage = await apiClient.getUsageSummary(auth.dextoApiKey);
        return usage.credits_usd;
    } catch {
        return null;
    }
}

/**
 * Full interactive setup flow with wizard navigation.
 * Users can go back to previous steps to change their selections.
 */
async function handleInteractiveSetup(_options: CLISetupOptions): Promise<void> {
    console.log(chalk.cyan('\n🗿 Dexto Nova Setup\n'));

    p.intro(chalk.cyan("Let's configure your AI agent"));

    // Initialize wizard state
    let state: SetupWizardState = { step: 'setupType' };

    // Wizard loop - process steps until complete
    while (state.step !== 'complete') {
        switch (state.step) {
            case 'setupType':
                state = await wizardStepSetupType(state);
                break;
            case 'provider':
                state = await wizardStepProvider(state);
                break;
            case 'model':
                state = await wizardStepModel(state);
                break;
            case 'reasoning':
                state = await wizardStepReasoning(state);
                break;
            case 'apiKey':
                state = await wizardStepApiKey(state);
                break;
            case 'mode':
                state = await wizardStepMode(state);
                break;
        }
    }

    // Save preferences and show completion
    // Quick start handles its own saving, so skip for that path
    if (!state.quickStartHandled) {
        await saveWizardPreferences(state);
    }
}

/**
 * Wizard Step: Setup Type (Quick Start vs Custom)
 */
async function wizardStepSetupType(state: SetupWizardState): Promise<SetupWizardState> {
    // Build options list - only show Dexto Nova when feature is enabled
    const options: Array<{ value: string; label: string; hint: string }> = [];

    if (isDextoAuthEnabled()) {
        options.push({
            value: 'dexto-nova',
            label: `${chalk.magenta('★')} Dexto Nova`,
            hint: 'All models, one account - login to get started (recommended)',
        });
    }

    options.push(
        {
            value: 'quick',
            label: `${chalk.green('●')} Quick Start`,
            hint: 'Google Gemini (free) - no account needed',
        },
        {
            value: 'custom',
            label: `${chalk.blue('●')} Custom Setup`,
            hint: 'Choose your provider (OpenAI, Anthropic, Ollama, etc.)',
        }
    );

    const setupType = await p.select({
        message: 'How would you like to set up Dexto?',
        options,
    });

    if (p.isCancel(setupType)) {
        p.cancel('Setup cancelled');
        process.exit(0);
    }

    if (setupType === 'dexto-nova') {
        // Handle Dexto Nova flow - login if needed, then proceed to model selection
        await handleDextoProviderSetup();
        return { ...state, step: 'complete', quickStartHandled: true };
    }

    if (setupType === 'quick') {
        // Quick start bypasses the wizard - handle it directly
        const result = await handleQuickStart({ onCancel: 'back' });
        if (result === 'cancelled') {
            return { ...state, step: 'setupType' };
        }
        return { ...state, step: 'complete', quickStartHandled: true };
    }

    return { ...state, step: 'provider', setupType: 'custom' };
}

/**
 * Wizard Step: Provider Selection
 */
async function wizardStepProvider(state: SetupWizardState): Promise<SetupWizardState> {
    showStepProgress('provider', state.provider);

    const provider = await selectProvider();

    if (provider === null) {
        // Treat prompt cancellation as "back" to avoid accidentally exiting the setup wizard.
        // Users can still cancel setup from the initial setup type step.
        return { ...state, step: 'setupType', provider: undefined };
    }

    if (provider === '_back') {
        return { ...state, step: 'setupType', provider: undefined };
    }

    return { ...state, step: 'model', provider };
}

/**
 * Wizard Step: Model Selection
 */
async function wizardStepModel(state: SetupWizardState): Promise<SetupWizardState> {
    const provider = state.provider!;
    showStepProgress('model', provider);

    // Handle local providers with special setup flow
    if (provider === 'local') {
        const localResult = await setupLocalModels();
        // Only proceed if user actually selected a model
        // (handles cancelled, back, skipped, and any other incomplete states)
        if (!hasSelectedModel(localResult)) {
            return { ...state, step: 'provider', model: undefined };
        }
        const model = getModelFromResult(localResult);
        const nextStep = getReasoningProfile(provider, model).capable ? 'reasoning' : 'mode';
        return { ...state, step: nextStep, model };
    }

    if (provider === 'ollama') {
        const ollamaResult = await setupOllamaModels();
        // Only proceed if user actually selected a model
        if (!hasSelectedModel(ollamaResult)) {
            return { ...state, step: 'provider', model: undefined };
        }
        const model = getModelFromResult(ollamaResult);
        const nextStep = getReasoningProfile(provider, model).capable ? 'reasoning' : 'mode';
        return { ...state, step: nextStep, model };
    }

    // Handle baseURL for providers that need it
    let baseURL: string | undefined;
    if (providerRequiresBaseURL(provider)) {
        const result = await promptForBaseURL(provider);
        if (result === null) {
            // User cancelled - go back to provider selection
            return { ...state, step: 'provider', model: undefined, baseURL: undefined };
        }
        baseURL = result;
    }

    // Cloud provider model selection with back option
    const selection = await selectModelWithBack(provider);

    if (selection === '_back') {
        return { ...state, step: 'provider', model: undefined, baseURL: undefined };
    }

    const model = selection.model;
    const nextStep = getReasoningProfile(provider, model).capable ? 'reasoning' : 'apiKey';
    return { ...state, step: nextStep, model, baseURL };
}

/**
 * Wizard Step: Reasoning Variant Selection (native provider/model values)
 */
async function wizardStepReasoning(state: SetupWizardState): Promise<SetupWizardState> {
    const provider = state.provider!;
    const model = state.model!;
    const isLocalProvider = provider === 'local' || provider === 'ollama';
    showStepProgress('reasoning', provider, model);

    const support = getReasoningProfile(provider, model);
    const initialValue = support.defaultVariant ?? support.supportedVariants[0];

    const result = await p.select({
        message: 'Select reasoning variant',
        options: [
            ...getReasoningVariantSelectOptions(support.supportedVariants, support.defaultVariant),
            { value: '_back' as const, label: chalk.gray('← Back'), hint: 'Change model' },
        ],
        ...(initialValue ? { initialValue } : {}),
    });

    if (p.isCancel(result)) {
        // Treat prompt cancellation as "back" to avoid accidentally exiting the setup wizard.
        return { ...state, step: 'model', reasoningPreset: undefined };
    }

    if (result === '_back') {
        return { ...state, step: 'model', reasoningPreset: undefined };
    }

    // Determine next step based on provider type
    const nextStep = isLocalProvider ? 'mode' : 'apiKey';
    const shouldPersistOverride = result !== support.defaultVariant;
    return {
        ...state,
        step: nextStep,
        // Keep preferences minimal: selecting the profile default variant results in no override.
        reasoningPreset: shouldPersistOverride ? result : undefined,
    };
}

/**
 * Wizard Step: API Key Configuration
 */
async function wizardStepApiKey(state: SetupWizardState): Promise<SetupWizardState> {
    const provider = state.provider!;
    const model = state.model!;
    showStepProgress('apiKey', provider, model);

    const hasKey = hasApiKeyConfigured(provider);
    const needsApiKey = requiresApiKey(provider);

    if (needsApiKey && !hasKey) {
        const result = await interactiveApiKeySetup(provider, {
            exitOnCancel: false,
            model,
        });

        if (result.cancelled) {
            // Go back to reasoning variant if model supports it, otherwise model selection
            const prevStep = getReasoningProfile(provider, model).capable ? 'reasoning' : 'model';
            return { ...state, step: prevStep, apiKeySkipped: undefined };
        }

        const apiKeySkipped = result.skipped || !result.success;
        return { ...state, step: 'mode', apiKeySkipped };
    } else if (needsApiKey && hasKey) {
        p.log.success(`API key for ${getProviderDisplayName(provider)} already configured`);
    } else if (!needsApiKey) {
        p.log.info(`${getProviderDisplayName(provider)} does not require an API key`);
    }

    return { ...state, step: 'mode', apiKeySkipped: false };
}

/**
 * Wizard Step: Default Mode Selection
 */
async function wizardStepMode(state: SetupWizardState): Promise<SetupWizardState> {
    const provider = state.provider!;
    const model = state.model!;
    const isLocalProvider = provider === 'local' || provider === 'ollama';
    const hasReasoningStep = getReasoningProfile(provider, model).capable;
    showStepProgress('mode', provider, model);

    const mode = await selectDefaultModeWithBack();

    if (mode === '_back') {
        // Go back to the previous *interactive* step. Some steps (like apiKey) may be
        // auto-skipped when not required or already configured, so "back" from mode
        // should avoid bouncing the user back to the same screen.
        if (isLocalProvider) {
            return {
                ...state,
                step: hasReasoningStep ? 'reasoning' : 'model',
                defaultMode: undefined,
            };
        }

        const canShowApiKeyStep = requiresApiKey(provider) && !hasApiKeyConfigured(provider);
        let prevStep: SetupWizardState['step'] = 'model';
        if (canShowApiKeyStep) {
            prevStep = 'apiKey';
        } else if (hasReasoningStep) {
            prevStep = 'reasoning';
        }
        return {
            ...state,
            step: prevStep,
            defaultMode: undefined,
        };
    }

    return { ...state, step: 'complete', defaultMode: mode };
}

/**
 * Select model with back option
 */
async function selectModelWithBack(
    provider: LLMProvider
): Promise<{ model: string; isCustomSelection?: boolean } | '_back'> {
    const providerInfo = LLM_REGISTRY[provider];

    if (providerInfo?.models && providerInfo.models.length > 0) {
        const curatedModels = getCuratedModelsForProvider(provider);

        if (provider === 'openrouter') {
            const curatedOptions = curatedModels
                .slice(0, 8)
                .filter((m) => m.name !== 'openrouter/free')
                .map((m) => ({
                    value: m.name,
                    label: m.displayName || m.name,
                }));

            if (supportsCustomModels(provider)) {
                p.log.info(chalk.gray('Tip: You can add or edit custom models via /model'));

                const manageCustomModels = await p.confirm({
                    message: 'Manage custom models now?',
                    initialValue: false,
                });

                if (p.isCancel(manageCustomModels)) {
                    return '_back';
                }

                if (manageCustomModels) {
                    const customModel = await handleCustomModelManagement(provider);
                    if (customModel) {
                        return { model: customModel, isCustomSelection: true };
                    }
                }
            }

            const result = await p.select({
                message: `Select a model for ${getProviderDisplayName(provider)}`,
                options: [
                    {
                        value: 'openrouter/free' as const,
                        label: 'OpenRouter Free Models',
                        hint: '(recommended)',
                    },
                    ...curatedOptions,
                    {
                        value: '_back' as const,
                        label: chalk.gray('← Back'),
                        hint: 'Change provider',
                    },
                ],
            });

            if (p.isCancel(result) || result === '_back') {
                return '_back';
            }

            return { model: result as string };
        }

        const defaultModel =
            curatedModels.find((m) => m.default) ??
            providerInfo.models.find((m) => m.default) ??
            curatedModels[0] ??
            providerInfo.models[0];
        if (!defaultModel) {
            p.log.warn('No models available for this provider');
            return '_back';
        }

        const curatedOptions = curatedModels
            .slice(0, 8)
            .filter((m) => m.name !== defaultModel.name)
            .map((m) => ({
                value: m.name,
                label: m.displayName || m.name,
            }));

        if (supportsCustomModels(provider)) {
            p.log.info(chalk.gray('Tip: You can add or edit custom models via /model'));

            const manageCustomModels = await p.confirm({
                message: 'Manage custom models now?',
                initialValue: false,
            });

            if (p.isCancel(manageCustomModels)) {
                return '_back';
            }

            if (manageCustomModels) {
                const customModel = await handleCustomModelManagement(provider);
                if (customModel) {
                    return { model: customModel, isCustomSelection: true };
                }
            }
        }

        const result = await p.select({
            message: `Select a model for ${getProviderDisplayName(provider)}`,
            options: [
                {
                    value: defaultModel.name,
                    label: defaultModel.displayName || defaultModel.name,
                    hint: '(recommended)',
                },
                ...curatedOptions,
                {
                    value: '_back' as const,
                    label: chalk.gray('← Back'),
                    hint: 'Change provider',
                },
            ],
        });

        if (p.isCancel(result) || result === '_back') {
            return '_back';
        }

        return { model: result as string };
    }

    // For providers that accept any model, show text input with back hint
    p.log.info(chalk.gray('Press Ctrl+C to go back'));
    const defaultModel = providerInfo?.models?.find((m) => m.default)?.name;
    const model = await p.text({
        message: `Enter model name for ${getProviderDisplayName(provider)}`,
        placeholder: defaultModel || 'e.g., gpt-4-turbo',
        validate: (value) => {
            const trimmed = typeof value === 'string' ? value.trim() : '';
            if (!trimmed) return 'Model name is required';
            return undefined;
        },
    });

    if (p.isCancel(model)) {
        return '_back';
    }

    return { model: typeof model === 'string' ? model.trim() : '' };
}

/**
 * Select default mode with back option
 */
async function handleCustomModelManagement(providerOverride?: LLMProvider): Promise<string | null> {
    const models = await loadCustomModels();

    const choices = [
        { value: 'add' as const, label: 'Add custom model' },
        ...(models.length > 0 ? [{ value: 'edit' as const, label: 'Edit custom model' }] : []),
        ...(models.length > 0 ? [{ value: 'delete' as const, label: 'Delete custom model' }] : []),
        { value: 'back' as const, label: 'Back' },
    ];

    const action = await p.select({
        message: 'Custom models',
        options: choices,
    });

    if (p.isCancel(action) || action === 'back') {
        return null;
    }

    if (action === 'add') {
        const created = await runCustomModelWizard(null, providerOverride);
        return created?.name ?? null;
    }

    if (action === 'edit') {
        const selected = await selectCustomModel(models);
        if (!selected) {
            return null;
        }
        const updated = await runCustomModelWizard(selected, providerOverride);
        return updated?.name ?? null;
    }

    if (action === 'delete') {
        const model = await selectCustomModel(models);
        if (!model) {
            return null;
        }
        const confirm = await p.confirm({
            message: `Delete custom model "${model.displayName || model.name}"?`,
            initialValue: false,
        });
        if (p.isCancel(confirm) || !confirm) {
            return null;
        }
        await deleteCustomModel(model.name);
        p.log.success(`Deleted ${model.displayName || model.name}`);
        return null;
    }

    return null;
}

async function selectCustomModel(models: CustomModel[]): Promise<CustomModel | null> {
    if (models.length === 0) {
        p.log.info('No custom models available.');
        return null;
    }

    const selection = await p.select({
        message: 'Select a custom model',
        options: models.map((model) => ({
            value: model.name,
            label: model.displayName || model.name,
        })),
    });

    if (p.isCancel(selection)) {
        return null;
    }

    return models.find((model) => model.name === selection) ?? null;
}

async function runCustomModelWizard(
    initialModel?: CustomModel | null,
    providerOverride?: LLMProvider
): Promise<CustomModel | null> {
    const values = await promptCustomModelValues(initialModel ?? null, providerOverride);
    if (!values) {
        return null;
    }

    const model: CustomModel = {
        name: values.name,
        provider: values.provider,
        ...(values.baseURL ? { baseURL: values.baseURL } : {}),
        ...(values.displayName ? { displayName: values.displayName } : {}),
        ...(values.maxInputTokens ? { maxInputTokens: values.maxInputTokens } : {}),
        ...(values.apiKey ? { apiKey: values.apiKey } : {}),
        ...(values.filePath ? { filePath: values.filePath } : {}),
        ...(values.reasoningPreset ? { reasoning: { variant: values.reasoningPreset } } : {}),
    };

    await saveCustomModel(model);
    if (initialModel && initialModel.name !== model.name) {
        await deleteCustomModel(initialModel.name);
    }
    p.log.success(`${initialModel ? 'Updated' : 'Saved'} ${model.displayName || model.name}`);
    return model;
}

async function promptCustomModelValues(
    initialModel: CustomModel | null,
    providerOverride?: LLMProvider
): Promise<{
    name: string;
    provider: CustomModel['provider'];
    baseURL?: string;
    displayName?: string;
    maxInputTokens?: number;
    apiKey?: string;
    filePath?: string;
    reasoningPreset?: ReasoningVariant;
} | null> {
    const providers = [
        'openai-compatible',
        'openrouter',
        'litellm',
        'glama',
        'bedrock',
        'ollama',
        'local',
        'vertex',
        ...(isDextoAuthEnabled() ? ['dexto-nova'] : []),
    ] as const;

    const effectiveProvider = initialModel?.provider ?? providerOverride;

    let provider: CustomModel['provider'] | symbol;
    if (effectiveProvider) {
        provider = effectiveProvider as CustomModel['provider'];
    } else {
        provider = (await p.select({
            message: 'Custom model provider',
            options: providers.map((value) => ({ value, label: value })),
            initialValue: 'openai-compatible',
        })) as CustomModel['provider'] | symbol;

        if (p.isCancel(provider)) {
            return null;
        }
    }

    const name = await p.text({
        message: 'Model name',
        initialValue: initialModel?.name ?? '',
        validate: (value) => {
            const trimmed = typeof value === 'string' ? value.trim() : '';
            return trimmed ? undefined : 'Model name is required';
        },
    });

    if (p.isCancel(name)) {
        return null;
    }

    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (provider === 'openrouter' || provider === 'glama' || provider === 'dexto-nova') {
        const isValidFormat = trimmedName.includes('/');
        if (!isValidFormat) {
            p.log.warn('Model name should include a provider prefix, e.g. anthropic/claude-3.5');
        }
    }

    const displayName = await p.text({
        message: 'Display name (optional)',
        initialValue: initialModel?.displayName ?? '',
    });

    if (p.isCancel(displayName)) {
        return null;
    }

    let baseURL: string | undefined;
    if (provider === 'openai-compatible' || provider === 'litellm') {
        const baseURLInput = await p.text({
            message: 'Base URL',
            initialValue: initialModel?.baseURL?.trim() ?? '',
            validate: (value) => {
                const trimmed = typeof value === 'string' ? value.trim() : '';
                if (!trimmed) return 'Base URL is required';
                try {
                    new URL(trimmed);
                    return undefined;
                } catch {
                    return 'Base URL must be a valid URL';
                }
            },
        });
        if (p.isCancel(baseURLInput)) {
            return null;
        }
        const baseURLValue = typeof baseURLInput === 'string' ? baseURLInput.trim() : '';
        baseURL = baseURLValue || undefined;
    }

    const maxInputTokensInput = await p.text({
        message: 'Max input tokens (optional)',
        initialValue: initialModel?.maxInputTokens?.toString() ?? '',
        validate: (value) => {
            const trimmed = typeof value === 'string' ? value.trim() : '';
            if (!trimmed) return undefined;
            const parsed = Number(value);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                return 'Enter a positive integer';
            }
            return undefined;
        },
    });

    if (p.isCancel(maxInputTokensInput)) {
        return null;
    }

    let apiKey: string | undefined;
    if (provider !== 'bedrock' && provider !== 'vertex') {
        const apiKeyInput = await p.text({
            message: 'API key (optional)',
            initialValue: initialModel?.apiKey ?? '',
        });

        if (p.isCancel(apiKeyInput)) {
            return null;
        }

        const apiKeyValue = typeof apiKeyInput === 'string' ? apiKeyInput.trim() : '';
        apiKey = apiKeyValue || undefined;
    }

    let filePath: string | undefined;
    if (provider === 'local') {
        const filePathInput = await p.text({
            message: 'GGUF file path',
            initialValue: initialModel?.filePath ?? '',
            validate: (value) => {
                const trimmed = typeof value === 'string' ? value.trim() : '';
                if (!trimmed) return 'File path is required';
                if (!trimmed.toLowerCase().endsWith('.gguf')) {
                    return 'File path must end with .gguf';
                }
                return undefined;
            },
        });
        if (p.isCancel(filePathInput)) {
            return null;
        }
        const filePathValue = typeof filePathInput === 'string' ? filePathInput.trim() : '';
        filePath = filePathValue || undefined;
    }

    let reasoningPreset: ReasoningVariant | undefined;
    const reasoningSupport = getReasoningProfile(provider, trimmedName);
    if (reasoningSupport.capable) {
        const preset = await selectReasoningVariant(provider, trimmedName);
        if (preset === null) {
            return null;
        }
        // Keep the custom model config minimal: only store an override when not default.
        if (preset !== reasoningSupport.defaultVariant) {
            reasoningPreset = preset;
        }
    }

    const trimmedDisplayName = typeof displayName === 'string' ? displayName.trim() : '';
    const trimmedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    const trimmedMaxInputTokens =
        typeof maxInputTokensInput === 'string' ? maxInputTokensInput.trim() : '';

    return {
        name: trimmedName,
        provider,
        ...(baseURL ? { baseURL } : {}),
        ...(trimmedDisplayName ? { displayName: trimmedDisplayName } : {}),
        ...(trimmedMaxInputTokens ? { maxInputTokens: Number(trimmedMaxInputTokens) } : {}),
        ...(trimmedApiKey ? { apiKey: trimmedApiKey } : {}),
        ...(filePath ? { filePath } : {}),
        ...(reasoningPreset ? { reasoningPreset } : {}),
    };
}

async function selectDefaultModeWithBack(): Promise<
    'cli' | 'web' | 'server' | 'discord' | 'telegram' | 'mcp' | '_back'
> {
    const result = await p.select({
        message: 'How do you want to use Dexto by default?',
        options: [
            {
                value: 'cli' as const,
                label: `${chalk.green('●')} Terminal`,
                hint: 'Chat in your terminal (most popular)',
            },
            {
                value: 'web' as const,
                label: `${chalk.blue('●')} Browser`,
                hint: 'Web UI at localhost:3000',
            },
            {
                value: 'server' as const,
                label: `${chalk.cyan('●')} API Server`,
                hint: 'REST API for integrations',
            },
            { value: '_back' as const, label: chalk.gray('← Back'), hint: 'Go to previous step' },
        ],
    });

    if (p.isCancel(result)) {
        return '_back';
    }

    return result as 'cli' | 'web' | 'server' | 'discord' | 'telegram' | 'mcp' | '_back';
}

/**
 * Save wizard state to preferences
 */
async function saveWizardPreferences(state: SetupWizardState): Promise<void> {
    const provider = state.provider!;
    const model = state.model!;
    const defaultMode = state.defaultMode!;
    const apiKeySkipped = state.apiKeySkipped || false;

    const needsApiKey = requiresApiKey(provider);
    const apiKeyVar = getProviderEnvVar(provider);

    // For local provider, sync the active model in state.json
    if (provider === 'local') {
        await setActiveModel(model);
    }

    // Build preferences options
    const preferencesOptions: CreatePreferencesOptions = {
        provider,
        model,
        defaultMode,
        setupCompleted: true,
        apiKeyPending: apiKeySkipped,
    };

    if (needsApiKey && !apiKeySkipped) {
        preferencesOptions.apiKeyVar = apiKeyVar;
    }
    if (state.baseURL) {
        preferencesOptions.baseURL = state.baseURL;
    }
    if (state.reasoningPreset) {
        preferencesOptions.reasoning = { variant: state.reasoningPreset };
    }

    const preferences = createInitialPreferences(preferencesOptions);
    await saveGlobalPreferences(preferences);

    // Analytics
    capture('dexto_setup', {
        provider,
        model,
        setupMode: 'interactive',
        setupVariant: 'custom',
        defaultMode,
        hasBaseURL: Boolean(state.baseURL),
        apiKeySkipped,
    });

    await showSetupComplete(provider, model, defaultMode, apiKeySkipped);
}

/**
 * Non-interactive setup with CLI options
 */
async function handleNonInteractiveSetup(options: CLISetupOptions): Promise<void> {
    const provider = options.provider!;
    const model = options.model || getDefaultModel(provider);

    if (!model) {
        console.error(chalk.red(`❌ Model is required for provider '${provider}'.`));
        console.error(chalk.gray(`   Use --model option to specify a model.`));
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

    // For local provider, sync the active model in state.json
    if (provider === 'local') {
        await setActiveModel(model);
    }

    capture('dexto_setup', {
        provider,
        model,
        hadApiKeyBefore,
        setupMode: 'non-interactive',
    });

    console.log(chalk.green('\n✨ Setup complete! Dexto is ready to use.\n'));
}

/**
 * Settings menu for users who already have setup complete.
 * Loops back to menu after each action until user exits.
 */
async function showSettingsMenu(): Promise<void> {
    p.intro(chalk.cyan('⚙️  Dexto Settings'));

    // Settings menu loop - returns to menu after each action
    while (true) {
        // Load current preferences (refresh each iteration)
        let currentPrefs;
        try {
            currentPrefs = await loadGlobalPreferences();
        } catch {
            currentPrefs = null;
        }

        if (!currentPrefs && !globalPreferencesExist()) {
            p.log.warn('No preferences found yet. Run setup to create them.');
            await handleInteractiveSetup({
                interactive: true,
                force: false,
                quickStart: false,
                defaultAgent: 'coding-agent',
            });
            return;
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
                ...(currentPrefs.llm.reasoning
                    ? [
                          `Reasoning Variant: ${chalk.cyan(currentPrefs.llm.reasoning.variant)}` +
                              (currentPrefs.llm.reasoning.budgetTokens != null
                                  ? ` (budgetTokens=${chalk.cyan(String(currentPrefs.llm.reasoning.budgetTokens))})`
                                  : ''),
                      ]
                    : []),
            ].join('\n');

            p.note(currentConfig, 'Current Configuration');
        }

        const currentProviderLabel = currentPrefs?.llm.provider ?? 'not set';
        const currentModelLabel = currentPrefs?.llm.model || 'not set';

        const options: Array<{ value: string; label: string; hint: string }> = [
            {
                value: 'model',
                label: 'Change model',
                hint: `Currently: ${currentProviderLabel} / ${currentModelLabel}`,
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
        ];

        if (isDextoAuthEnabled()) {
            options.splice(2, 0, {
                value: 'credits',
                label: 'Buy Dexto Nova credits',
                hint: 'Open billing page in your browser',
            });
        }

        const action = await p.select({
            message: 'What would you like to do?',
            options,
        });

        // Exit conditions
        if (p.isCancel(action) || action === 'exit') {
            p.outro(`Run ${chalk.cyan('dexto')} to start Dexto`);
            return;
        }

        // Execute action and loop back (except for reset which exits)
        switch (action) {
            case 'model':
                await changeModel(); // Always prompt for provider selection
                break;
            case 'mode':
                await changeDefaultMode();
                break;
            case 'credits':
                await openCreditsPage();
                break;
            case 'apikey':
                await updateApiKey(currentPrefs?.llm.provider);
                break;
            case 'reset': {
                // Reset exits the menu after completion, but returns to menu if cancelled
                const resetCompleted = await resetSetup();
                if (resetCompleted) {
                    return;
                }
                break;
            }
            case 'file':
                showPreferencesFilePath();
                break;
        }

        // Add separator before next iteration
        console.log('');
    }
}

/**
 * Change model setting (includes provider selection)
 */
async function changeModel(currentProvider?: LLMProvider): Promise<void> {
    let provider: LLMProvider | null | '_back' = currentProvider ?? null;

    // If no provider specified, show selection
    // When Dexto auth is enabled, show Dexto/Other choice first (matching first-time setup flow)
    if (!provider && isDextoAuthEnabled()) {
        const providerChoice = await p.select({
            message: 'Choose your model source',
            options: [
                {
                    value: 'dexto-nova',
                    label: `${chalk.magenta('★')} Dexto Nova`,
                    hint: 'All models, one account',
                },
                {
                    value: 'other',
                    label: `${chalk.blue('●')} Other providers`,
                    hint: 'OpenAI, Anthropic, Gemini, Ollama, etc.',
                },
            ],
        });

        if (p.isCancel(providerChoice)) {
            p.log.warn('Model change cancelled');
            return;
        }

        if (providerChoice === 'dexto-nova') {
            // Use the same Dexto setup flow as first-time setup
            const completed = await handleDextoProviderSetup({ exitOnCancel: false });
            if (!completed) {
                return;
            }
            return;
        }

        // 'other' - fall through to normal provider selection
    }

    // Get provider if not already set
    if (!provider) {
        provider = await selectProvider();
    }

    // Handle cancellation or back from selectProvider
    if (provider === null || provider === '_back') {
        p.log.warn('Model change cancelled');
        return;
    }

    // Special handling for local providers - use dedicated setup flows
    if (provider === 'local') {
        const localResult = await setupLocalModels();
        // Only proceed if user actually selected a model
        // (handles cancelled, back, skipped - returns to menu without saving)
        if (!hasSelectedModel(localResult)) {
            p.log.warn('Model change cancelled');
            return;
        }
        const model = getModelFromResult(localResult);
        const llmUpdate: {
            provider: LLMProvider;
            model: string;
            reasoning?: { variant: ReasoningVariant };
        } = {
            provider,
            model,
        };

        // Ask for reasoning variant if applicable
        if (getReasoningProfile(provider, model).capable) {
            const reasoningPreset = await selectReasoningVariant(provider, model);
            if (reasoningPreset === null) {
                p.log.warn('Model change cancelled');
                return;
            }
            const defaultReasoningVariant = getReasoningProfile(provider, model).defaultVariant;
            if (reasoningPreset !== defaultReasoningVariant) {
                llmUpdate.reasoning = { variant: reasoningPreset };
            }
        }

        await updateGlobalPreferences({ llm: llmUpdate });
        p.log.success(`Model changed to ${model}`);
        return;
    }

    if (provider === 'ollama') {
        const ollamaResult = await setupOllamaModels();
        // Only proceed if user actually selected a model
        if (!hasSelectedModel(ollamaResult)) {
            p.log.warn('Model change cancelled');
            return;
        }
        const model = getModelFromResult(ollamaResult);
        const llmUpdate: {
            provider: LLMProvider;
            model: string;
            reasoning?: { variant: ReasoningVariant };
        } = {
            provider,
            model,
        };

        // Ask for reasoning variant if applicable
        if (getReasoningProfile(provider, model).capable) {
            const reasoningPreset = await selectReasoningVariant(provider, model);
            if (reasoningPreset === null) {
                p.log.warn('Model change cancelled');
                return;
            }
            const defaultReasoningVariant = getReasoningProfile(provider, model).defaultVariant;
            if (reasoningPreset !== defaultReasoningVariant) {
                llmUpdate.reasoning = { variant: reasoningPreset };
            }
        }

        await updateGlobalPreferences({ llm: llmUpdate });
        p.log.success(`Model changed to ${model}`);
        return;
    }

    // Standard flow for cloud providers
    const model = await selectModel(provider);

    // Handle cancellation from selectModel
    if (model === null) {
        p.log.warn('Model change cancelled');
        return;
    }

    const apiKeyVar = getProviderEnvVar(provider);
    const needsApiKey = requiresApiKey(provider);
    const hasKey = hasApiKeyConfigured(provider);

    // Check if API key is needed and missing - prompt for it
    if (needsApiKey && !hasKey) {
        const result = await interactiveApiKeySetup(provider, {
            exitOnCancel: false,
            model,
        });

        if (result.cancelled) {
            p.log.warn('Model change cancelled');
            return;
        }

        // If user skipped API key setup, still allow model change but warn
        if (result.skipped || !result.success) {
            p.log.warn(
                `API key setup was skipped. You'll need to configure ${apiKeyVar} before using this model.`
            );
        }
    }

    const llmUpdate: {
        provider: LLMProvider;
        model: string;
        apiKey?: string;
        reasoning?: { variant: ReasoningVariant };
    } = {
        provider,
        model,
    };
    // Only include apiKey for providers that need it
    if (needsApiKey) {
        llmUpdate.apiKey = `$${apiKeyVar}`;
    }

    // Ask for reasoning variant if applicable
    if (getReasoningProfile(provider, model).capable) {
        const reasoningPreset = await selectReasoningVariant(provider, model);
        if (reasoningPreset === null) {
            p.log.warn('Model change cancelled');
            return;
        }
        const defaultReasoningVariant = getReasoningProfile(provider, model).defaultVariant;
        if (reasoningPreset !== defaultReasoningVariant) {
            llmUpdate.reasoning = { variant: reasoningPreset };
        }
    }

    await updateGlobalPreferences({ llm: llmUpdate });

    p.log.success(`Model changed to ${model}`);
}

/**
 * Change default mode setting
 */
async function changeDefaultMode(): Promise<void> {
    const mode = await selectDefaultMode();

    // Handle cancellation
    if (mode === null) {
        p.log.warn('Mode change cancelled');
        return;
    }

    await updateGlobalPreferences({
        defaults: { defaultMode: mode },
    });

    p.log.success(`Default mode changed to ${mode}`);
}

/**
 * Update API key for current provider
 */
async function updateApiKey(currentProvider?: LLMProvider): Promise<void> {
    const provider = currentProvider || (await selectProvider());

    // Handle cancellation or back from selectProvider
    if (provider === null || provider === '_back') {
        p.log.warn('API key update cancelled');
        return;
    }

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
            p.log.info('Skipped API key setup');
            return;
        }
    }

    const result = await interactiveApiKeySetup(provider, {
        exitOnCancel: false,
        skipVerification: false,
    });

    if (result.success) {
        p.log.success(`API key updated for ${getProviderDisplayName(provider)}`);
    } else {
        p.log.warn('API key update cancelled');
    }
}

/**
 * Reset setup to start fresh
 */
async function resetSetup(): Promise<boolean> {
    const confirm = await p.confirm({
        message: 'This will erase your current configuration. Continue?',
        initialValue: false,
    });

    if (p.isCancel(confirm) || !confirm) {
        p.log.info('Reset cancelled');
        return false; // Indicate reset was cancelled
    }

    // Run full setup - this will complete a fresh setup
    await handleInteractiveSetup({
        interactive: true,
        force: true,
        defaultAgent: 'coding-agent',
        quickStart: false,
    });

    return true; // Indicate reset completed
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
            chalk.gray('Example commands:'),
            chalk.gray(`  code ${prefsPath}     # Open in VS Code`),
            chalk.gray(`  nano ${prefsPath}     # Edit in terminal`),
            chalk.gray(`  cat ${prefsPath}      # View contents`),
        ].join('\n'),
        'Preferences File Location'
    );
}

/**
 * Select default mode interactively
 * Returns null if user cancels
 */
async function selectDefaultMode(): Promise<
    'cli' | 'web' | 'server' | 'discord' | 'telegram' | 'mcp' | null
> {
    const mode = await p.select({
        message: 'How do you want to use Dexto by default?',
        options: [
            {
                value: 'cli' as const,
                label: `${chalk.green('●')} Terminal`,
                hint: 'Chat in your terminal (most popular)',
            },
            {
                value: 'web' as const,
                label: `${chalk.blue('●')} Browser`,
                hint: 'Web UI at localhost:3000',
            },
            {
                value: 'server' as const,
                label: `${chalk.cyan('●')} API Server`,
                hint: 'REST API for integrations',
            },
        ],
    });

    if (p.isCancel(mode)) {
        return null;
    }

    return mode;
}

/**
 * Select reasoning variant for models where we expose reasoning tuning.
 */
async function selectReasoningVariant(
    provider: LLMProvider,
    model: string
): Promise<ReasoningVariant | null> {
    const support = getReasoningProfile(provider, model);
    const initialValue = support.defaultVariant ?? support.supportedVariants[0];
    const variant = await p.select({
        message: 'Select reasoning variant',
        options: getReasoningVariantSelectOptions(
            support.supportedVariants,
            support.defaultVariant
        ),
        ...(initialValue ? { initialValue } : {}),
    });

    if (p.isCancel(variant)) {
        return null;
    }

    return variant;
}

/**
 * Select model interactively
 * Returns null if user cancels
 */
async function selectModel(provider: LLMProvider): Promise<string | null> {
    const providerInfo = LLM_REGISTRY[provider];

    // For providers with a fixed model list
    if (providerInfo?.models && providerInfo.models.length > 0) {
        const curatedModels = getCuratedModelsForProvider(provider);

        if (provider === 'openrouter') {
            const curatedOptions = curatedModels
                .slice(0, 8)
                .filter((m) => m.name !== 'openrouter/free')
                .map((m) => ({
                    value: m.name,
                    label: m.displayName || m.name,
                }));

            if (supportsCustomModels(provider)) {
                p.log.info(chalk.gray('Tip: You can add or edit custom models via /model'));

                const manageCustomModels = await p.confirm({
                    message: 'Manage custom models now?',
                    initialValue: false,
                });

                if (p.isCancel(manageCustomModels)) {
                    return null;
                }

                if (manageCustomModels) {
                    const customModel = await handleCustomModelManagement(provider);
                    if (customModel) {
                        return customModel;
                    }
                }
            }

            const selected = await p.select({
                message: `Select a model for ${getProviderDisplayName(provider)}`,
                options: [
                    {
                        value: 'openrouter/free' as const,
                        label: 'OpenRouter Free Models',
                        hint: '(recommended)',
                    },
                    ...curatedOptions,
                ],
                initialValue: 'openrouter/free',
            });

            if (p.isCancel(selected)) {
                return null;
            }

            return selected as string;
        }

        const defaultModel =
            curatedModels.find((m) => m.default) ??
            providerInfo.models.find((m) => m.default) ??
            curatedModels[0] ??
            providerInfo.models[0];
        if (!defaultModel) {
            return null;
        }

        const curatedOptions = curatedModels
            .slice(0, 8)
            .filter((m) => m.name !== defaultModel.name)
            .map((m) => ({
                value: m.name,
                label: m.displayName || m.name,
            }));

        if (supportsCustomModels(provider)) {
            p.log.info(chalk.gray('Tip: You can add or edit custom models via /model'));

            const manageCustomModels = await p.confirm({
                message: 'Manage custom models now?',
                initialValue: false,
            });

            if (p.isCancel(manageCustomModels)) {
                return null;
            }

            if (manageCustomModels) {
                const customModel = await handleCustomModelManagement(provider);
                if (customModel) {
                    return customModel;
                }
            }
        }

        const selected = await p.select({
            message: `Select a model for ${getProviderDisplayName(provider)}`,
            options: [
                {
                    value: defaultModel.name,
                    label: defaultModel.displayName || defaultModel.name,
                    hint: '(recommended)',
                },
                ...curatedOptions,
            ],
            initialValue: defaultModel.name,
        });

        if (p.isCancel(selected)) {
            return null;
        }

        return selected as string;
    }

    // For providers that accept any model (openai-compatible, openrouter, etc.)
    const modelInput = await p.text({
        message: `Enter model name for ${getProviderDisplayName(provider)}`,
        placeholder:
            provider === 'openrouter' ? 'e.g., anthropic/claude-3.5-sonnet' : 'e.g., llama-3-70b',
        validate: (value) => {
            const trimmed = typeof value === 'string' ? value.trim() : '';
            if (!trimmed) {
                return 'Model name is required';
            }
            return undefined;
        },
    });

    if (p.isCancel(modelInput)) {
        return null;
    }

    if (typeof modelInput !== 'string') {
        return null;
    }

    return modelInput.trim();
}

/**
 * Prompt for base URL for custom endpoints
 * Returns null if user cancels (to go back)
 */
async function promptForBaseURL(provider: LLMProvider): Promise<string | null> {
    p.log.info(chalk.gray('Press Ctrl+C to go back'));

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
            const trimmed = typeof value === 'string' ? value.trim() : '';
            if (!trimmed) {
                return 'Base URL is required for this provider';
            }
            try {
                new URL(trimmed);
            } catch {
                return 'Please enter a valid URL';
            }
            return undefined;
        },
    });

    if (p.isCancel(baseURL)) {
        return null;
    }

    return typeof baseURL === 'string' ? baseURL.trim() : '';
}

/**
 * Show setup complete message
 */
async function showSetupComplete(
    provider: LLMProvider,
    model: string,
    defaultMode: string,
    apiKeySkipped: boolean = false
): Promise<void> {
    const modeCommand = defaultMode === 'web' ? 'dexto' : `dexto --mode ${defaultMode}`;
    const isLocalProvider = provider === 'local' || provider === 'ollama';

    if (apiKeySkipped) {
        console.log(chalk.rgb(255, 165, 0)('\n⚠️  Setup complete (API key pending)\n'));
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
                  `  API Key: ${chalk.rgb(255, 165, 0)('Not configured')}`,
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
        ...(isLocalProvider
            ? [`  Run ${chalk.cyan('dexto setup')} again to manage local models`]
            : []),
        `  In the interactive CLI, run ${chalk.cyan('/model')} to switch models`,
        `  Run ${chalk.cyan('dexto --help')} for more options`,
    ].join('\n');

    console.log(summary);
    console.log('');
}
