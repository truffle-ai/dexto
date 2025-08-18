# Technical Plan: Enhanced Commands Integration

## Overview

Implement enhanced CLI commands that integrate with the global preferences system. This includes a new `dexto setup` command, enhanced `dexto install` command with preference injection, and new `dexto update-agent` command for preference updates.

## Command Structure

### Setup Command (`dexto setup`)

#### CLI Interface
```typescript
// src/app/cli/commands/setup.ts

import { Command } from 'commander';
import { type LLMProvider, LLM_PROVIDERS } from '@core/llm/registry.js';
import { handleSetupCommand } from '@core/setup/index.js';

export interface SetupCommandOptions {
  llmProvider?: LLMProvider;
  model?: string;
  defaultAgent?: string;
  noInteractive?: boolean;
}

/**
 * Register setup command with commander
 */
export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Configure global Dexto preferences')
    .option('--llm-provider <provider>', `LLM provider (${LLM_PROVIDERS.join(', ')})`)
    .option('--model <model>', 'Model name (uses provider default if not specified)')
    .option('--default-agent <agent>', 'Default agent name (default: default-agent)')
    .option('--no-interactive', 'Run in non-interactive mode')
    .action(async (options: SetupCommandOptions) => {
      try {
        await handleSetupCommand(options);
      } catch (error) {
        console.error(`Setup failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}
```

#### Usage Examples
```bash
# Interactive setup with provider selection
dexto setup

# Non-interactive setup with OpenAI
dexto setup --llm-provider openai --no-interactive

# Setup with specific model
dexto setup --llm-provider google --model gemini-2.5-pro

# Setup with custom default agent
dexto setup --llm-provider openai --default-agent my-agent
```

### Enhanced Install Command (`dexto install`)

#### Enhanced CLI Interface
```typescript
// src/app/cli/commands/install.ts

import { Command } from 'commander';
import { type LLMProvider } from '@core/llm/registry.js';
import { installAgent } from '@core/agent-registry/installer.js';
import { loadGlobalPreferences } from '@core/preferences/loader.js';
import { injectLLMPreferences } from '@core/preferences/injection.js';

export interface InstallCommandOptions {
  agent: string;
  llmProvider?: LLMProvider;
  model?: string;
  apiKey?: string;
  noPreferences?: boolean;
}

/**
 * Enhanced install command with preference injection
 */
export function registerInstallCommand(program: Command): void {
  program
    .command('install')
    .alias('i')
    .argument('<agent>', 'Agent name to install from registry')
    .description('Install an agent from the registry with preference injection')
    .option('--llm-provider <provider>', 'Override LLM provider for this agent')
    .option('--model <model>', 'Override model for this agent')
    .option('--api-key <key>', 'Override API key for this agent')
    .option('--no-preferences', 'Skip preference injection (use agent defaults)')
    .action(async (agentName: string, options: InstallCommandOptions) => {
      try {
        await handleEnhancedInstallCommand(agentName, options);
      } catch (error) {
        console.error(`Install failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}

/**
 * Handle enhanced install with preference injection
 */
async function handleEnhancedInstallCommand(
  agentName: string,
  options: InstallCommandOptions
): Promise<void> {
  console.log(`Installing agent: ${agentName}`);
  
  // 1. Install the agent (copy files)
  const installedPath = await installAgent(agentName);
  console.log(`✓ Agent installed to: ${installedPath}`);
  
  // 2. Apply preferences if not disabled
  if (!options.noPreferences) {
    const preferencesResult = await loadGlobalPreferences();
    
    if (preferencesResult.ok) {
      // Apply global preferences with CLI overrides
      const overrides = {
        provider: options.llmProvider,
        model: options.model,
        apiKey: options.apiKey
      };
      
      await injectPreferencesToAgent(
        installedPath,
        preferencesResult.data,
        overrides
      );
      
      console.log('✓ Applied global preferences to agent configs');
    } else {
      console.warn('⚠️  No global preferences found, using agent defaults');
      console.log('Run `dexto setup` to configure global preferences');
    }
  }
  
  console.log(`🎉 Agent "${agentName}" is ready to use!`);
}
```

#### Usage Examples
```bash
# Install with preference injection (default behavior)
dexto install triage-agent

# Install with provider override
dexto install triage-agent --llm-provider anthropic

# Install without preference injection
dexto install triage-agent --no-preferences

# Install with full LLM overrides
dexto install triage-agent --llm-provider openai --model gpt-4o --api-key $MY_API_KEY
```

### Update Agent Command (`dexto update-agent`)

#### CLI Interface
```typescript
// src/app/cli/commands/update-agent.ts

import { Command } from 'commander';
import { type LLMProvider } from '@core/llm/registry.js';
import { findInstalledAgent } from '@core/agent-registry/finder.js';
import { loadGlobalPreferences } from '@core/preferences/loader.js';
import { injectPreferencesToDirectory } from '@core/preferences/injection.js';

export interface UpdateAgentOptions {
  agent: string;
  llmProvider?: LLMProvider;
  model?: string;
  apiKey?: string;
  resetToDefaults?: boolean;
}

/**
 * Register update-agent command
 */
export function registerUpdateAgentCommand(program: Command): void {
  program
    .command('update-agent')
    .argument('<agent>', 'Installed agent name to update')
    .description('Update an installed agent with current global preferences')
    .option('--llm-provider <provider>', 'Override LLM provider')
    .option('--model <model>', 'Override model')
    .option('--api-key <key>', 'Override API key')
    .option('--reset-to-defaults', 'Reset agent to original defaults (ignore preferences)')
    .action(async (agentName: string, options: UpdateAgentOptions) => {
      try {
        await handleUpdateAgentCommand(agentName, options);
      } catch (error) {
        console.error(`Update failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}

/**
 * Handle agent update with preferences
 */
async function handleUpdateAgentCommand(
  agentName: string,
  options: UpdateAgentOptions
): Promise<void> {
  // Find installed agent
  const installedPath = await findInstalledAgent(agentName);
  if (!installedPath) {
    throw new Error(`Agent "${agentName}" is not installed. Run \`dexto install ${agentName}\` first.`);
  }
  
  if (options.resetToDefaults) {
    // TODO: Implement reset to original agent defaults
    console.log('🔄 Resetting agent to original defaults...');
    console.log('⚠️  Reset functionality not yet implemented');
    return;
  }
  
  // Load current preferences
  const preferencesResult = await loadGlobalPreferences();
  if (!preferencesResult.ok) {
    throw new Error('No global preferences found. Run `dexto setup` first.');
  }
  
  // Apply updated preferences
  const overrides = {
    provider: options.llmProvider,
    model: options.model,
    apiKey: options.apiKey
  };
  
  console.log(`🔄 Updating agent "${agentName}" with current preferences...`);
  
  await injectPreferencesToAgent(
    installedPath,
    preferencesResult.data,
    overrides
  );
  
  console.log('✓ Agent updated successfully!');
}
```

#### Usage Examples
```bash
# Update agent with current global preferences
dexto update-agent triage-agent

# Update with provider override
dexto update-agent triage-agent --llm-provider anthropic

# Reset agent to original defaults (future feature)
dexto update-agent triage-agent --reset-to-defaults
```

## Integration with Existing Commands

### Enhanced Default Resolution

#### Modified `dexto` (no arguments)
```typescript
// src/app/index.ts - Enhanced default agent resolution

import { loadGlobalPreferences, globalPreferencesExist } from '@core/preferences/loader.js';
import { resolveConfigPath } from '@core/utils/path.js';

async function resolveDefaultAgent(): Promise<string> {
  // Check for global preferences first
  if (globalPreferencesExist()) {
    const preferencesResult = await loadGlobalPreferences();
    if (preferencesResult.ok) {
      const defaultAgentName = preferencesResult.data.defaults.defaultAgent;
      
      // Try to resolve from registry
      try {
        return await resolveConfigPath(defaultAgentName);
      } catch (error) {
        console.warn(`⚠️  Configured default agent "${defaultAgentName}" not found, falling back to bundled default`);
      }
    }
  }
  
  // Fallback to existing logic
  return await resolveConfigPath();
}
```

### First-Time Setup Integration

#### Modified CLI Entry Point
```typescript
// src/app/index.ts - First-time detection

import { globalPreferencesExist } from '@core/preferences/loader.js';

export async function main(): Promise<void> {
  // ... existing argument parsing ...
  
  // Check for first-time user (preferences-based)
  if (!globalPreferencesExist() && !configPath && !options.agent) {
    console.log('👋 Welcome to Dexto! Let\'s get you set up...');
    console.log('Run `dexto setup` to configure your preferences.\n');
    
    // TODO: Remove legacy first-time setup, use preferences system
    // For now, exit with helpful message
    process.exit(0);
  }
  
  // ... rest of existing logic ...
}
```

## Command Registration

### Updated Commander Integration
```typescript
// src/app/cli/index.ts

import { Command } from 'commander';
import { registerSetupCommand } from './commands/setup.js';
import { registerInstallCommand } from './commands/install.js';
import { registerUpdateAgentCommand } from './commands/update-agent.js';

export function createCLIProgram(): Command {
  const program = new Command();
  
  // ... existing configuration ...
  
  // Register new/enhanced commands
  registerSetupCommand(program);
  registerInstallCommand(program);
  registerUpdateAgentCommand(program);
  
  return program;
}
```

## Error Handling

### Command-Specific Error Codes
```typescript
// Add to existing DextoErrorCode enum
export enum DextoErrorCode {
  // ... existing codes ...
  
  // Command execution errors
  COMMAND_SETUP_FAILED = 'command_setup_failed',
  COMMAND_INSTALL_FAILED = 'command_install_failed',
  COMMAND_UPDATE_FAILED = 'command_update_failed',
  COMMAND_AGENT_NOT_FOUND = 'command_agent_not_found',
  COMMAND_NO_PREFERENCES = 'command_no_preferences'
}
```

### Graceful Error Handling
```typescript
// Consistent error handling pattern across commands
try {
  await commandAction();
} catch (error) {
  if (error instanceof DextoValidationError) {
    console.error('❌ Validation failed:');
    error.issues.forEach(issue => {
      console.error(`   • ${issue.message}`);
    });
  } else if (error instanceof DextoRuntimeError) {
    console.error(`❌ ${error.message}`);
  } else {
    console.error(`❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
}
```

## Backward Compatibility

### Existing Command Behavior
- **`dexto -a agent-name`**: Works unchanged, no preference injection
- **`dexto --agent agent-name`**: Works unchanged, no preference injection  
- **Legacy install behavior**: Preserved for existing workflows

### Deprecation Strategy
```typescript
// Gradual transition messaging
if (isLegacyInstallUsage()) {
  console.log('💡 Tip: Try `dexto setup` to configure global preferences');
  console.log('   Then `dexto install agent-name` will use your preferences automatically!');
}
```

## Testing Requirements

### Unit Tests
- **Setup command**: Interactive/non-interactive modes, validation, error cases
- **Install command**: With/without preferences, overrides, multi-agent systems
- **Update command**: Existing agents, missing agents, reset functionality
- **Integration**: Commander registration, argument parsing, help text

### Integration Tests
- **End-to-end workflow**: Setup → install → update → use agent
- **Preference injection**: Verify all .yml files updated correctly
- **CLI integration**: Full command parsing and execution
- **Error scenarios**: Missing files, permission errors, validation failures

### Manual Testing Scenarios
```bash
# Complete workflow test
dexto setup --llm-provider google
dexto install triage-agent
dexto update-agent triage-agent --llm-provider openai
dexto -a triage-agent "test message"

# Error handling test
dexto setup --no-interactive  # Should fail with helpful message
dexto update-agent non-existent-agent  # Should fail gracefully
dexto install invalid-agent  # Should show registry error
```

## Migration Strategy

### Phase 1: Add New Commands
- Implement `setup`, enhanced `install`, and `update-agent` commands
- Keep existing behavior unchanged
- Add help text and documentation

### Phase 2: Integrate with Existing Flow
- Update first-time detection to use preferences
- Enhance default agent resolution
- Add helpful hints for legacy users

### Phase 3: Encourage Migration
- Add tips and suggestions for using new commands
- Update documentation to favor new workflow
- Collect feedback and iterate

This command design creates a cohesive preference-aware CLI experience while preserving backward compatibility and enabling smooth user migration.