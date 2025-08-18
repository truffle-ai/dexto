# Technical Plan: Setup Utilities

## Overview

Extract and enhance the existing first-time setup logic into reusable utilities that can power both CLI commands and future Web UI setup flows. These utilities handle provider selection, model selection, and API key configuration in both interactive and non-interactive modes.

## Current State Analysis

### Existing Setup Logic
The current first-time setup is in `src/app/cli/utils/first-time-setup.ts` and includes:
- Provider selection UI with clack prompts
- Config file creation with YAML manipulation
- API key setup integration
- Environment reloading

### Extraction Strategy
Move business logic to `src/core/setup/` and keep CLI-specific prompts in `src/app/cli/`.

## Core Setup Utilities

### Provider Selection Logic
```typescript
// src/core/setup/provider-selection.ts

import { type LLMProvider, LLM_PROVIDERS, getDefaultModelForProvider } from '@core/llm/registry.js';
import { getPrimaryApiKeyEnvVar } from '@core/utils/api-key-resolver.js';

export interface ProviderOption {
  provider: LLMProvider;
  label: string;
  hint: string;
  requiresPayment: boolean;
  isRecommended: boolean;
}

/**
 * Get available provider options with metadata
 */
export function getProviderOptions(): ProviderOption[] {
  return [
    {
      provider: 'google',
      label: 'Google Gemini',
      hint: 'Free tier available - Recommended for beginners',
      requiresPayment: false,
      isRecommended: true
    },
    {
      provider: 'groq', 
      label: 'Groq',
      hint: 'Free tier available - Very fast responses',
      requiresPayment: false,
      isRecommended: true
    },
    {
      provider: 'openai',
      label: 'OpenAI',
      hint: 'Most popular, requires payment',
      requiresPayment: true,
      isRecommended: false
    },
    {
      provider: 'anthropic',
      label: 'Anthropic',
      hint: 'High quality models, requires payment', 
      requiresPayment: true,
      isRecommended: false
    }
  ];
}

/**
 * Get default model for a provider
 */
export function getDefaultModelForSetup(provider: LLMProvider): string {
  return getDefaultModelForProvider(provider);
}

/**
 * Get API key environment variable name for a provider
 */
export function getApiKeyEnvVar(provider: LLMProvider): string {
  return getPrimaryApiKeyEnvVar(provider);
}
```

### Setup Orchestration
```typescript
// src/core/setup/orchestrator.ts

import { type LLMProvider } from '@core/llm/registry.js';
import { type GlobalPreferences } from '@core/preferences/schemas.js';
import { createInitialPreferences, saveGlobalPreferences } from '@core/preferences/loader.js';
import { Result, ok, fail } from '@core/utils/result.js';
import { logger } from '@core/logger/index.js';
import { getDefaultModelForSetup, getApiKeyEnvVar } from './provider-selection.js';

export interface SetupOptions {
  provider?: LLMProvider;
  model?: string;
  defaultAgent?: string;
  interactive: boolean;
}

export interface SetupResult {
  preferences: GlobalPreferences;
  isNewSetup: boolean;
}

/**
 * Orchestrate the complete setup process
 * @param options Setup configuration options
 * @param providerPicker Function to pick provider interactively (injected by CLI)
 * @returns Result with created preferences
 */
export async function orchestrateSetup(
  options: SetupOptions,
  providerPicker?: () => Promise<LLMProvider | null>
): Promise<Result<SetupResult, SetupContext>> {
  
  // Determine provider
  let provider = options.provider;
  if (!provider) {
    if (!options.interactive) {
      return fail([{
        code: DextoErrorCode.SETUP_MISSING_PROVIDER,
        message: 'Provider required in non-interactive mode. Use --llm-provider option.',
        severity: 'error',
        context: {}
      }]);
    }
    
    if (!providerPicker) {
      return fail([{
        code: DextoErrorCode.SETUP_NO_PROVIDER_PICKER,
        message: 'Interactive mode requires provider picker function',
        severity: 'error', 
        context: {}
      }]);
    }
    
    const selected = await providerPicker();
    if (!selected) {
      return fail([{
        code: DextoErrorCode.SETUP_CANCELLED,
        message: 'Setup cancelled by user',
        severity: 'error',
        context: {}
      }]);
    }
    
    provider = selected;
  }
  
  // Determine model
  const model = options.model || getDefaultModelForSetup(provider);
  
  // Determine API key env var
  const apiKeyVar = getApiKeyEnvVar(provider);
  
  // Create preferences
  const preferences = createInitialPreferences(
    provider,
    model,
    apiKeyVar,
    options.defaultAgent
  );
  
  // Save preferences
  const saveResult = await saveGlobalPreferences(preferences);
  if (!saveResult.ok) {
    return fail(saveResult.issues);
  }
  
  logger.info(`✓ Setup completed with ${provider}/${model}`);
  
  return ok({
    preferences,
    isNewSetup: true
  });
}
```

### API Key Setup Integration
```typescript
// src/core/setup/api-key-setup.ts

import { type LLMProvider } from '@core/llm/registry.js';
import { interactiveApiKeySetup } from '@app/cli/utils/interactive-api-key-setup.js';
import { Result, ok, fail } from '@core/utils/result.js';

export interface ApiKeySetupOptions {
  provider: LLMProvider;
  interactive: boolean;
}

/**
 * Handle API key setup for a provider
 * @param options API key setup options
 * @returns Result indicating success/failure
 */
export async function setupApiKeyForProvider(
  options: ApiKeySetupOptions
): Promise<Result<boolean, SetupContext>> {
  
  if (!options.interactive) {
    // Non-interactive mode: assume API key is already set in environment
    return ok(true);
  }
  
  try {
    // Use existing interactive API key setup
    const success = await interactiveApiKeySetup(options.provider);
    return ok(success);
    
  } catch (error) {
    return fail([{
      code: DextoErrorCode.SETUP_API_KEY_FAILED,
      message: `API key setup failed: ${error instanceof Error ? error.message : String(error)}`,
      severity: 'error',
      context: { provider: options.provider }
    }]);
  }
}
```

## CLI Integration Layer

### Command Interface
```typescript
// src/app/cli/commands/setup.ts

import * as p from '@clack/prompts';
import chalk from 'chalk';
import { type LLMProvider } from '@core/llm/registry.js';
import { getProviderOptions, orchestrateSetup, setupApiKeyForProvider } from '@core/setup/index.js';
import { applyLayeredEnvironmentLoading } from '@core/utils/env.js';

export interface CLISetupOptions {
  llmProvider?: LLMProvider;
  model?: string;
  defaultAgent?: string;
  noInteractive?: boolean;
}

/**
 * CLI provider picker using clack prompts
 */
async function showProviderPicker(): Promise<LLMProvider | null> {
  const options = getProviderOptions();
  
  const choice = await p.select({
    message: 'Choose your AI provider',
    options: options.map(opt => ({
      value: opt.provider,
      label: `${opt.isRecommended ? '🟢' : '🟡'} ${opt.label}`,
      hint: opt.hint
    }))
  });

  if (p.isCancel(choice)) {
    return null;
  }

  return choice as LLMProvider;
}

/**
 * Handle setup command from CLI
 */
export async function handleSetupCommand(options: CLISetupOptions): Promise<void> {
  console.log(chalk.cyan("\n🎉 Setting up Dexto preferences...\n"));

  // Run setup orchestration
  const result = await orchestrateSetup({
    provider: options.llmProvider,
    model: options.model,
    defaultAgent: options.defaultAgent,
    interactive: !options.noInteractive
  }, showProviderPicker);
  
  if (!result.ok) {
    console.error(chalk.red(`❌ Setup failed: ${result.issues[0].message}`));
    process.exit(1);
  }
  
  const { preferences } = result.data;
  
  // Setup API key
  console.log(chalk.dim("\n🔑 Setting up API key...\n"));
  const keyResult = await setupApiKeyForProvider({
    provider: preferences.llm.provider,
    interactive: !options.noInteractive
  });
  
  if (!keyResult.ok || !keyResult.data) {
    console.log(chalk.yellow('\n⚠️  Preferences created but API key not set.'));
    console.log(chalk.dim('Add your API key to .env and run dexto again.'));
    return;
  }
  
  // Reload environment
  await applyLayeredEnvironmentLoading();
  
  console.log(chalk.green('\n✨ Setup complete! Dexto is ready to use.\n'));
}
```

## Reusability Design

### Core vs CLI Separation
```typescript
// Core business logic (reusable)
src/core/setup/
├── provider-selection.ts    # Provider metadata and logic
├── orchestrator.ts         # Setup workflow coordination  
├── api-key-setup.ts       # API key configuration
└── index.ts              # Exports

// CLI-specific interaction (not reusable)
src/app/cli/commands/
├── setup.ts              # CLI command handling + clack prompts
└── index.ts             # Command exports
```

### Future Web UI Integration
```typescript
// Future Web UI can reuse core logic:
import { orchestrateSetup, getProviderOptions } from '@core/setup/index.js';

// Custom UI picker instead of CLI prompts
const selectedProvider = await showWebProviderPicker();

const result = await orchestrateSetup({
  provider: selectedProvider,
  interactive: true
}, async () => selectedProvider);
```

## Migration from Existing Code

### Code Movement Strategy
1. **Extract provider options** from `first-time-setup.ts` → `provider-selection.ts`
2. **Extract setup orchestration** → `orchestrator.ts`  
3. **Keep CLI prompts** in `src/app/cli/commands/setup.ts`
4. **Reuse API key setup** from existing `interactive-api-key-setup.ts`

### Existing Code Preservation
- **Keep `handleFirstTimeSetup()`** for legacy compatibility (marked for removal)
- **Keep `showProviderPicker()`** in CLI layer with clack prompts
- **Reuse `interactiveApiKeySetup()`** without modification

## Error Handling

**TODO: Revisit error pattern - consider using SetupError factory + direct exceptions instead of Result pattern for single setup errors. Result pattern better suited for validation with multiple issues.**

### New Error Codes
```typescript
export enum DextoErrorCode {
  // ... existing codes ...
  
  // Setup process errors
  SETUP_MISSING_PROVIDER = 'setup_missing_provider',
  SETUP_NO_PROVIDER_PICKER = 'setup_no_provider_picker', 
  SETUP_CANCELLED = 'setup_cancelled',
  SETUP_API_KEY_FAILED = 'setup_api_key_failed',
  SETUP_INVALID_PROVIDER = 'setup_invalid_provider',
  SETUP_INVALID_MODEL = 'setup_invalid_model'
}
```

### Context Type
```typescript
export interface SetupContext {
  provider?: LLMProvider;
  model?: string;
  defaultAgent?: string;
  step?: string;
  error?: string;
}
```

## Non-Interactive Mode Requirements

### Command Line Interface
```bash
# Interactive mode (default)
dexto setup
# → Shows provider picker, model selection, API key setup

# Non-interactive mode with required args
dexto setup --llm-provider openai --no-interactive
# → Uses defaults for model, creates preferences, skips API key prompts

# Non-interactive mode missing args (should fail)
dexto setup --no-interactive
# → Error: "Provider required in non-interactive mode"
```

### Validation Rules
- **Provider required**: Must specify `--llm-provider` in non-interactive mode
- **Model optional**: Uses provider default if not specified
- **API key handling**: Assumes environment is already configured
- **Clear errors**: Specific error messages for missing requirements

## Integration Testing

### Test Scenarios
1. **Interactive setup**: Full flow with provider selection and API key setup
2. **Non-interactive success**: All required args provided
3. **Non-interactive failure**: Missing required args
4. **Cancellation**: User cancels during provider selection
5. **API key failure**: API key setup fails or is skipped
6. **File system errors**: Permission issues, disk full

### Mock Integration
```typescript
// Test setup orchestration without actual file operations
const mockSavePreferences = vi.fn().mockResolvedValue(ok(undefined));
const mockProviderPicker = vi.fn().mockResolvedValue('openai');

const result = await orchestrateSetup({
  provider: undefined,
  interactive: true
}, mockProviderPicker);

expect(result.ok).toBe(true);
expect(mockProviderPicker).toHaveBeenCalled();
```

## Migration Path

### Phase 1: Extract Core Logic
- Move provider options to `core/setup/provider-selection.ts`
- Create `core/setup/orchestrator.ts` with setup workflow
- Keep existing CLI setup working

### Phase 2: Create New Command
- Implement `src/app/cli/commands/setup.ts`
- Add commander.js integration
- Test both interactive and non-interactive modes

### Phase 3: Deprecate Old Setup
- Mark `handleFirstTimeSetup()` for removal
- Update first-time detection to use preference system
- Remove legacy first-time setup code

This design creates reusable setup utilities while preserving the existing user experience and enabling future Web UI integration.