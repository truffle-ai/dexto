# Technical Plan: Setup Command Implementation  

## Overview

Implement the `dexto setup` CLI command by building directly on existing first-time setup logic and preference system. Keep setup logic in the CLI layer - no need for "reusable utilities" until Web UI is actually needed.

## Current State Analysis

### Existing Setup Logic
The current first-time setup is in `src/app/cli/utils/first-time-setup.ts` and includes:
- Provider selection UI with clack prompts
- Config file creation with YAML manipulation
- API key setup integration
- Environment reloading

### Implementation Strategy
Keep all setup logic in `src/app/cli/commands/setup.ts` - simple and direct.

## Setup Command Implementation

### Direct CLI Implementation
```typescript
// src/app/cli/commands/setup.ts

import * as p from '@clack/prompts';
import { type LLMProvider, getDefaultModelForProvider } from '@core/llm/registry.js';
import { getPrimaryApiKeyEnvVar } from '@core/utils/api-key-resolver.js';
import { createInitialPreferences, saveGlobalPreferences } from '@core/preferences/loader.js';
import { interactiveApiKeySetup } from '@app/cli/utils/interactive-api-key-setup.js';

// Provider options directly in the command
const providerOptions = [
  { 
    value: 'google', 
    label: '🟢 Google Gemini', 
    hint: 'Free tier available - Recommended for beginners' 
  },
  { 
    value: 'groq', 
    label: '🟢 Groq', 
    hint: 'Free tier available - Very fast responses' 
  },
  { 
    value: 'openai', 
    label: '🟡 OpenAI', 
    hint: 'Most popular, requires payment' 
  },
  { 
    value: 'anthropic', 
    label: '🟡 Anthropic', 
    hint: 'High quality models, requires payment' 
  }
];
```

### Complete Setup Command
```typescript
// src/app/cli/commands/setup.ts - Complete implementation

export async function handleSetupCommand(options: CLISetupOptions): Promise<void> {
  console.log(chalk.cyan("\n🎉 Setting up Dexto preferences...\n"));

  // Determine provider (interactive or from options)
  let provider = options.llmProvider;
  if (!provider) {
    if (options.noInteractive) {
      throw new Error('Provider required in non-interactive mode. Use --llm-provider option.');
    }
    
    const choice = await p.select({
      message: 'Choose your AI provider',
      options: providerOptions
    });

    if (p.isCancel(choice)) {
      console.log('Setup cancelled');
      return;
    }
    provider = choice as LLMProvider;
  }
  
  // Get model and API key details
  const model = options.model || getDefaultModelForProvider(provider);
  const apiKeyVar = getPrimaryApiKeyEnvVar(provider);
  
  // Create and save preferences  
  const preferences = createInitialPreferences(provider, model, apiKeyVar);
  await saveGlobalPreferences(preferences);
  
  // Setup API key interactively
  if (!options.noInteractive) {
    await interactiveApiKeySetup(provider);
  }
  
  console.log(chalk.green('\n✨ Setup complete! Dexto is ready to use.\n'));
}
```

## Integration with Commander

```typescript
// src/app/cli/commands/index.ts
export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Configure global Dexto preferences')
    .option('--llm-provider <provider>', 'LLM provider (openai, anthropic, google, groq)')
    .option('--model <model>', 'Model name (uses provider default if not specified)')
    .option('--default-agent <agent>', 'Default agent name (default: default-agent)')
    .option('--no-interactive', 'Run in non-interactive mode')
    .action(async (options: CLISetupOptions) => {
      await handleSetupCommand(options);
    });
}
```

**Benefits:**
- **Simple**: No abstractions, just a straightforward CLI command
- **Direct**: Uses existing utilities without complex orchestration layers
- **YAGNI**: No premature Web UI abstractions

## Error Handling

Use standard error factories following the pattern in `src/core/config/errors.ts`:

```typescript
// src/app/cli/commands/setup.ts - Simple error handling
if (options.noInteractive && !provider) {
  throw new Error('Provider required in non-interactive mode. Use --llm-provider option.');
}

// Handle setup cancellation
if (p.isCancel(choice)) {
  console.log('Setup cancelled');
  return;
}
```

**Simple and direct** - no complex error orchestration needed for CLI commands.