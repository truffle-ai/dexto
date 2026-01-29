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
    isReasoningCapableModel,
    getCuratedModelsForProvider,
} from '@dexto/core';
import { resolveApiKeyForProvider } from '@dexto/core';
import {
    createInitialPreferences,
    saveGlobalPreferences,
    loadGlobalPreferences,
    getGlobalPreferencesPath,
    updateGlobalPreferences,
    setActiveModel,
    isDextoAuthEnabled,
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
import { handleBrowserLogin } from './auth/login.js';
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

// ============================================================================
// Setup Wizard Types and Helpers
// ============================================================================

/**
 * Setup wizard step identifiers
 */
type SetupStep =
    | 'setupType'
    | 'provider'
    | 'model'
    | 'reasoningEffort'
    | 'apiKey'
    | 'mode'
    | 'complete';

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
    reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined;
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
    const showReasoningStep = model && isReasoningCapableModel(model);

    if (isLocalProvider) {
        const steps: Array<{ key: SetupStep; label: string }> = [
            { key: 'provider', label: 'Provider' },
            { key: 'model', label: 'Model' },
        ];
        if (showReasoningStep) {
            steps.push({ key: 'reasoningEffort', label: 'Reasoning' });
        }
        steps.push({ key: 'mode', label: 'Mode' });
        return steps;
    }

    const steps: Array<{ key: SetupStep; label: string }> = [
        { key: 'provider', label: 'Provider' },
        { key: 'model', label: 'Model' },
    ];
    if (showReasoningStep) {
        steps.push({ key: 'reasoningEffort', label: 'Reasoning' });
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
 * Quick start flow - pick a free provider with minimal prompts
 */
async function handleQuickStart(): Promise<void> {
    console.log(chalk.cyan('\n🚀 Quick Start\n'));

    p.intro(chalk.cyan('Quick Setup'));

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
                value: 'local' as const,
                label: `${chalk.cyan('●')} Local Models`,
                hint: 'Free, private, runs on your machine',
            },
        ],
    });

    if (p.isCancel(quickProvider)) {
        p.cancel('Setup cancelled');
        process.exit(0);
    }

    // Handle local models with dedicated setup flow
    if (quickProvider === 'local') {
        const localResult = await setupLocalModels();
        if (!hasSelectedModel(localResult)) {
            p.cancel('Setup cancelled');
            process.exit(0);
        }
        const model = getModelFromResult(localResult);

        // CLI mode confirmation for local
        const useCli = await p.confirm({
            message: 'Start in Terminal mode? (You can change this later)',
            initialValue: true,
        });

        if (p.isCancel(useCli)) {
            p.cancel('Setup cancelled');
            process.exit(0);
        }

        const defaultMode = useCli ? 'cli' : await selectDefaultMode();
        if (defaultMode === null) {
            p.cancel('Setup cancelled');
            process.exit(0);
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
        return;
    }

    // Cloud provider flow (google or groq)
    const provider: LLMProvider = quickProvider;
    const model =
        getDefaultModelForProvider(provider) ||
        (provider === 'google' ? 'gemini-2.5-pro' : 'llama-3.3-70b-versatile');
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
            p.cancel('Setup cancelled');
            process.exit(0);
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
        p.cancel('Setup cancelled');
        process.exit(0);
    }

    const defaultMode = useCli ? 'cli' : await selectDefaultMode();

    // Handle cancellation
    if (defaultMode === null) {
        p.cancel('Setup cancelled');
        process.exit(0);
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
}

/**
 * Dexto setup flow - login if needed, select model, save preferences
 *
 * Config storage:
 * - provider: 'dexto' (the gateway provider)
 * - model: OpenRouter-style ID (e.g., 'anthropic/claude-haiku-4.5')
 *
 * Runtime handles routing requests through the Dexto gateway to the underlying provider.
 */
async function handleDextoProviderSetup(): Promise<void> {
    console.log(chalk.magenta('\n★ Dexto Setup\n'));

    // Check if user already has DEXTO_API_KEY
    const hasKey = await canUseDextoProvider();

    if (!hasKey) {
        p.note(
            `Dexto gives you instant access to ${chalk.cyan('all AI models')} with a single account.\n\n` +
                `We'll open your browser to sign in or create an account.`,
            'Login Required'
        );

        const shouldLogin = await p.confirm({
            message: 'Continue with browser login?',
            initialValue: true,
        });

        if (p.isCancel(shouldLogin) || !shouldLogin) {
            p.cancel('Setup cancelled');
            process.exit(0);
        }

        try {
            await handleBrowserLogin();
            // Verify key was actually provisioned (provisionKeys silently catches errors)
            if (!(await canUseDextoProvider())) {
                p.log.error(
                    'API key provisioning failed. Please try again or use `dexto setup` with a different provider.'
                );
                process.exit(1);
            }
            p.log.success('Login successful! Continuing with setup...');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            p.log.error(`Login failed: ${errorMessage}`);
            p.cancel('Setup cancelled - login required for Dexto');
            process.exit(1);
        }
    } else {
        p.log.success('Already logged in to Dexto');
    }

    // Model selection - show popular models in OpenRouter format
    // NOTE: This list is intentionally hardcoded (not from registry) to include
    // curated hints for onboarding UX. Keep model IDs in sync with:
    // packages/core/src/llm/registry.ts (LLM_REGISTRY.dexto.models)
    const model = await p.select({
        message: 'Select a model to start with',
        options: [
            // Claude models (Anthropic via Dexto gateway)
            {
                value: 'anthropic/claude-haiku-4.5',
                label: 'Claude 4.5 Haiku',
                hint: 'Fast & affordable (recommended)',
            },
            {
                value: 'anthropic/claude-sonnet-4.5',
                label: 'Claude 4.5 Sonnet',
                hint: 'Balanced performance and cost',
            },
            {
                value: 'anthropic/claude-opus-4.5',
                label: 'Claude 4.5 Opus',
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
        ],
    });

    if (p.isCancel(model)) {
        p.cancel('Setup cancelled');
        process.exit(0);
    }

    // Dexto setup always uses 'dexto' provider with OpenRouter model IDs
    const provider: LLMProvider = 'dexto';

    // Cast model to string (prompts library typing)
    const selectedModel = model as string;

    p.log.info(`${chalk.dim('Tip:')} You can switch models anytime with ${chalk.cyan('/model')}`);

    // Ask about default mode
    const defaultMode = await selectDefaultMode();

    if (defaultMode === null) {
        p.cancel('Setup cancelled');
        process.exit(0);
    }

    // Save preferences with explicit dexto provider and OpenRouter model ID
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
        setupVariant: 'dexto',
        defaultMode,
    });

    await showSetupComplete(provider, selectedModel, defaultMode, false);
}

/**
 * Full interactive setup flow with wizard navigation.
 * Users can go back to previous steps to change their selections.
 */
async function handleInteractiveSetup(_options: CLISetupOptions): Promise<void> {
    console.log(chalk.cyan('\n🗿 Dexto Setup\n'));

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
            case 'reasoningEffort':
                state = await wizardStepReasoningEffort(state);
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
    // Build options list - only show Dexto Credits when feature is enabled
    const options: Array<{ value: string; label: string; hint: string }> = [];

    if (isDextoAuthEnabled()) {
        options.push({
            value: 'dexto',
            label: `${chalk.magenta('★')} Dexto Credits`,
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

    if (setupType === 'dexto') {
        // Handle Dexto Credits flow - login if needed, then proceed to model selection
        await handleDextoProviderSetup();
        return { ...state, step: 'complete', quickStartHandled: true };
    }

    if (setupType === 'quick') {
        // Quick start bypasses the wizard - handle it directly
        await handleQuickStart();
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
        // Check if model supports reasoning effort
        const nextStep = isReasoningCapableModel(model) ? 'reasoningEffort' : 'mode';
        return { ...state, step: nextStep, model };
    }

    if (provider === 'ollama') {
        const ollamaResult = await setupOllamaModels();
        // Only proceed if user actually selected a model
        if (!hasSelectedModel(ollamaResult)) {
            return { ...state, step: 'provider', model: undefined };
        }
        const model = getModelFromResult(ollamaResult);
        // Check if model supports reasoning effort
        const nextStep = isReasoningCapableModel(model) ? 'reasoningEffort' : 'mode';
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
    const model = await selectModelWithBack(provider);

    if (model === '_back') {
        return { ...state, step: 'provider', model: undefined, baseURL: undefined };
    }

    // Check if model supports reasoning effort
    const nextStep = isReasoningCapableModel(model) ? 'reasoningEffort' : 'apiKey';
    return { ...state, step: nextStep, model, baseURL };
}

/**
 * Wizard Step: Reasoning Effort Selection (for OpenAI reasoning models)
 */
async function wizardStepReasoningEffort(state: SetupWizardState): Promise<SetupWizardState> {
    const provider = state.provider!;
    const model = state.model!;
    const isLocalProvider = provider === 'local' || provider === 'ollama';
    showStepProgress('reasoningEffort', provider, model);

    const result = await p.select({
        message: 'Select reasoning effort level',
        options: [
            {
                value: 'medium' as const,
                label: 'Medium (Recommended)',
                hint: 'Balanced reasoning for most tasks',
            },
            { value: 'low' as const, label: 'Low', hint: 'Light reasoning, fast responses' },
            {
                value: 'minimal' as const,
                label: 'Minimal',
                hint: 'Barely any reasoning, very fast',
            },
            { value: 'high' as const, label: 'High', hint: 'More thorough reasoning' },
            {
                value: 'xhigh' as const,
                label: 'Extra High',
                hint: 'Maximum reasoning, slower responses',
            },
            { value: 'none' as const, label: 'None', hint: 'Disable reasoning' },
            { value: '_back' as const, label: chalk.gray('← Back'), hint: 'Change model' },
        ],
    });

    if (p.isCancel(result)) {
        // Treat prompt cancellation as "back" to avoid accidentally exiting the setup wizard.
        return { ...state, step: 'model', reasoningEffort: undefined };
    }

    if (result === '_back') {
        return { ...state, step: 'model', reasoningEffort: undefined };
    }

    // Determine next step based on provider type
    const nextStep = isLocalProvider ? 'mode' : 'apiKey';
    return { ...state, step: nextStep, reasoningEffort: result };
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
            // Go back to reasoning effort if model supports it, otherwise model selection
            const prevStep = isReasoningCapableModel(model) ? 'reasoningEffort' : 'model';
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
    const hasReasoningStep = isReasoningCapableModel(model);
    showStepProgress('mode', provider, model);

    const mode = await selectDefaultModeWithBack();

    if (mode === '_back') {
        // Go back to previous step based on provider type and model capabilities
        if (isLocalProvider) {
            // Local: reasoning effort -> model
            return {
                ...state,
                step: hasReasoningStep ? 'reasoningEffort' : 'model',
                defaultMode: undefined,
            };
        }
        // Cloud: always go back to apiKey (reasoning effort comes before apiKey)
        return { ...state, step: 'apiKey', defaultMode: undefined };
    }

    return { ...state, step: 'complete', defaultMode: mode };
}

/**
 * Select model with back option
 */
async function selectModelWithBack(provider: LLMProvider): Promise<string | '_back'> {
    const providerInfo = LLM_REGISTRY[provider];

    if (providerInfo?.models && providerInfo.models.length > 0) {
        const curatedModels = getCuratedModelsForProvider(provider);
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

        if (p.isCancel(result)) {
            return '_back';
        }

        return result as string | '_back';
    }

    // For providers that accept any model, show text input with back hint
    p.log.info(chalk.gray('Press Ctrl+C to go back'));
    const defaultModel = providerInfo?.models?.find((m) => m.default)?.name;
    const model = await p.text({
        message: `Enter model name for ${getProviderDisplayName(provider)}`,
        placeholder: defaultModel || 'e.g., gpt-4-turbo',
        validate: (value) => {
            if (!value.trim()) return 'Model name is required';
            return undefined;
        },
    });

    if (p.isCancel(model)) {
        return '_back';
    }

    return model as string;
}

/**
 * Select default mode with back option
 */
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
    if (state.reasoningEffort) {
        preferencesOptions.reasoningEffort = state.reasoningEffort;
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

        // Show current configuration
        if (currentPrefs) {
            const currentConfig = [
                `Provider: ${chalk.cyan(getProviderDisplayName(currentPrefs.llm.provider))}`,
                `Model: ${chalk.cyan(currentPrefs.llm.model)}`,
                `Default Mode: ${chalk.cyan(currentPrefs.defaults.defaultMode)}`,
                ...(currentPrefs.llm.baseURL
                    ? [`Base URL: ${chalk.cyan(currentPrefs.llm.baseURL)}`]
                    : []),
                ...(currentPrefs.llm.reasoningEffort
                    ? [`Reasoning Effort: ${chalk.cyan(currentPrefs.llm.reasoningEffort)}`]
                    : []),
            ].join('\n');

            p.note(currentConfig, 'Current Configuration');
        }

        const action = await p.select({
            message: 'What would you like to do?',
            options: [
                {
                    value: 'model',
                    label: 'Change model',
                    hint: `Currently: ${currentPrefs?.llm.provider || 'not set'} / ${currentPrefs?.llm.model || 'not set'}`,
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
                    value: 'dexto',
                    label: `${chalk.magenta('★')} Dexto Credits`,
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

        if (providerChoice === 'dexto') {
            // Use the same Dexto setup flow as first-time setup
            await handleDextoProviderSetup();
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
            reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
        } = {
            provider,
            model,
        };

        // Ask for reasoning effort if applicable
        if (isReasoningCapableModel(model)) {
            const reasoningEffort = await selectReasoningEffort();
            if (reasoningEffort !== null) {
                llmUpdate.reasoningEffort = reasoningEffort;
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
            reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
        } = {
            provider,
            model,
        };

        // Ask for reasoning effort if applicable
        if (isReasoningCapableModel(model)) {
            const reasoningEffort = await selectReasoningEffort();
            if (reasoningEffort !== null) {
                llmUpdate.reasoningEffort = reasoningEffort;
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
        reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    } = {
        provider,
        model,
    };
    // Only include apiKey for providers that need it
    if (needsApiKey) {
        llmUpdate.apiKey = `$${apiKeyVar}`;
    }

    // Ask for reasoning effort if applicable
    if (isReasoningCapableModel(model)) {
        const reasoningEffort = await selectReasoningEffort();
        if (reasoningEffort !== null) {
            llmUpdate.reasoningEffort = reasoningEffort;
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
 * Select reasoning effort level for reasoning-capable models
 * Used in settings menu when changing to a reasoning-capable model
 */
async function selectReasoningEffort(): Promise<
    'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null
> {
    const effort = await p.select({
        message: 'Select reasoning effort level',
        options: [
            {
                value: 'medium' as const,
                label: 'Medium (Recommended)',
                hint: 'Balanced reasoning for most tasks',
            },
            { value: 'low' as const, label: 'Low', hint: 'Light reasoning, fast responses' },
            {
                value: 'minimal' as const,
                label: 'Minimal',
                hint: 'Barely any reasoning, very fast',
            },
            { value: 'high' as const, label: 'High', hint: 'More thorough reasoning' },
            {
                value: 'xhigh' as const,
                label: 'Extra High',
                hint: 'Maximum reasoning, slower responses',
            },
            { value: 'none' as const, label: 'None', hint: 'Disable reasoning' },
        ],
    });

    if (p.isCancel(effort)) {
        return null;
    }

    return effort;
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
            if (!value || value.trim().length === 0) {
                return 'Model name is required';
            }
            return undefined;
        },
    });

    if (p.isCancel(modelInput)) {
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
        return null;
    }

    return baseURL.trim();
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
