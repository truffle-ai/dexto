# Technical Plan: Preference-Aware Default Resolution

## Overview  

Enhance the CLI layer to check global preferences before calling existing `resolveConfigPath()` function. Keep the existing resolver intact - just add preference-aware logic at the CLI entry point for clean separation of concerns.


## Core Resolution Logic

### New Resolution Function
```typescript
// src/core/config/default-resolution.ts

import { getDextoProjectRoot, getDextoSourceRoot, isPath } from '@core/utils/path.js';
import { loadGlobalPreferences, globalPreferencesExist } from '@core/preferences/loader.js';
import { getAgentRegistry } from '@core/agent-registry/registry.js';
import { DextoRuntimeError, ErrorType } from '@core/errors/index.js';
import { logger } from '@core/logger/index.js';

/**
 * Resolve agent path with preference integration - REPLACES resolveConfigPath()
 * @param nameOrPath Optional agent name or explicit path
 * @returns Resolved absolute path to agent config
 * @throws DextoRuntimeError for any resolution failures
 */
export async function resolveAgentPath(nameOrPath?: string): Promise<string> {
  // 1. Handle explicit paths (highest priority)
  if (nameOrPath && isPath(nameOrPath)) {
    const resolved = path.resolve(nameOrPath);
    // Verify file exists - fail fast if not
    try {
      await fs.access(resolved);
      return resolved;
    } catch {
      throw new DextoRuntimeError(
        `Agent config file not found: ${resolved}`,
        { type: ErrorType.FILE_NOT_FOUND, path: resolved }
      );
    }
  }
  
  // 2. Handle registry names
  if (nameOrPath) {
    const registry = getAgentRegistry();
    return await registry.resolveAgent(nameOrPath); // Let registry throw its own errors
  }
  
  // 3. Default agent resolution based on execution context
  return await resolveDefaultAgentByContext();
}

/**
 * Resolve default agent based on execution context - no fallbacks, fail fast
 */
async function resolveDefaultAgentByContext(): Promise<string> {
  const executionContext = detectExecutionContext();
  
  switch (executionContext) {
    case 'dexto-source':
      return await resolveForDextoSource();
      
    case 'dexto-project':
      return await resolveForDextoProject();
      
    case 'global-cli':
      return await resolveForGlobalCLI();
      
    default:
      throw new DextoRuntimeError(
        `Unknown execution context: ${executionContext}`,
        { type: ErrorType.INTERNAL_ERROR }
      );
  }
}
```

## Context-Specific Resolution (No Fallbacks)

### Dexto Source Context
```typescript
/**
 * Resolution for Dexto source code context - bundled default only, no fallbacks
 */
async function resolveForDextoSource(): Promise<string> {
  const bundledPath = path.resolve('agents/default-agent.yml');
  
  try {
    await fs.access(bundledPath);
    return bundledPath;
  } catch {
    throw new DextoRuntimeError(
      `Bundled default agent not found: ${bundledPath}. Run npm run build first.`,
      { type: ErrorType.FILE_NOT_FOUND, path: bundledPath }
    );
  }
}
```

### Dexto Project Context
```typescript
/**
 * Resolution for Dexto project context - project default OR preferences default, no fallbacks
 */
async function resolveForDextoProject(): Promise<string> {
  const projectRoot = getDextoProjectRoot()!;
  
  // 1. Try project-local default-agent.yml first
  const projectDefaultPath = path.join(projectRoot, 'default-agent.yml');
  try {
    await fs.access(projectDefaultPath);
    return projectDefaultPath;
  } catch {
    // Not found, continue to preferences
  }
  
  // 2. Use preferences default agent name - REQUIRED if no project default
  if (!globalPreferencesExist()) {
    throw new DextoRuntimeError(
      `No project default-agent.yml found and no global preferences configured.\n` +
      `Either create ${projectDefaultPath} or run \`dexto setup\` to configure preferences.`,
      { type: ErrorType.CONFIGURATION_ERROR }
    );
  }
  
  const preferencesResult = await loadGlobalPreferences();
  if (!preferencesResult.ok) {
    throw new DextoRuntimeError(
      `Global preferences file is corrupted. Run \`dexto setup\` to fix.`,
      { type: ErrorType.CONFIGURATION_ERROR }
    );
  }
  
  if (!preferencesResult.data.setup.completed) {
    throw new DextoRuntimeError(
      `Global preferences setup is incomplete. Run \`dexto setup\` to complete.`,
      { type: ErrorType.CONFIGURATION_ERROR }
    );
  }
  
  const preferredAgentName = preferencesResult.data.defaults.defaultAgent;
  const registry = getAgentRegistry();
  return await registry.resolveAgent(preferredAgentName); // Let registry handle its own errors
}
```

### Global CLI Context  
```typescript
/**
 * Resolution for Global CLI context - preferences default REQUIRED, no fallbacks
 */
async function resolveForGlobalCLI(): Promise<string> {
  if (!globalPreferencesExist()) {
    throw new DextoRuntimeError(
      `No global preferences found. Run \`dexto setup\` to get started.`,
      { type: ErrorType.CONFIGURATION_ERROR }
    );
  }
  
  const preferencesResult = await loadGlobalPreferences();
  if (!preferencesResult.ok) {
    throw new DextoRuntimeError(
      `Global preferences file is corrupted. Run \`dexto setup\` to fix.`,
      { type: ErrorType.CONFIGURATION_ERROR }
    );
  }
  
  if (!preferencesResult.data.setup.completed) {
    throw new DextoRuntimeError(
      `Global preferences setup is incomplete. Run \`dexto setup\` to complete.`,
      { type: ErrorType.CONFIGURATION_ERROR }
    );
  }
  
  const preferredAgentName = preferencesResult.data.defaults.defaultAgent;
  const registry = getAgentRegistry();
  return await registry.resolveAgent(preferredAgentName); // Let registry handle its own errors
}
```

## Standardized Execution Context System

### Core Context Detection Utility
```typescript
// src/core/utils/execution-context.ts

import { getDextoProjectRoot, isDextoSourceCode } from './path.js';

export type ExecutionContext = 'dexto-source' | 'dexto-project' | 'global-cli';

/**
 * Detect current execution context - standardized across codebase
 * @param startPath Starting directory path (defaults to process.cwd())
 * @returns Execution context
 */
export function getExecutionContext(startPath: string = process.cwd()): ExecutionContext {
  // Check for Dexto source context first (most specific)
  if (isDextoSourceCode(startPath)) {
    return 'dexto-source';
  }
  
  // Check for Dexto project context
  if (getDextoProjectRoot(startPath)) {
    return 'dexto-project';
  }
  
  // Default to global CLI context
  return 'global-cli';
}

/**
 * Check if running in global CLI context (outside any dexto project)
 */
export function isGlobalCLI(startPath?: string): boolean {
  return getExecutionContext(startPath) === 'global-cli';
}

/**
 * Check if running in a dexto project context (not source code)
 */  
export function isDextoProject(startPath?: string): boolean {
  return getExecutionContext(startPath) === 'dexto-project';
}

/**
 * Check if running in dexto source code context
 */
export function isInDextoSource(startPath?: string): boolean {
  return getExecutionContext(startPath) === 'dexto-source';
}

/**
 * Get human-readable context description for logging/debugging
 */
export function getContextDescription(context: ExecutionContext): string {
  switch (context) {
    case 'dexto-source':
      return 'Dexto source code development';
    case 'dexto-project': 
      return 'Dexto project';
    case 'global-cli':
      return 'Global CLI usage';
  }
}
```

### Usage Throughout Codebase

```typescript
// src/core/utils/env.ts - Environment loading
import { getExecutionContext } from './execution-context.js';

export async function applyLayeredEnvironmentLoading(startPath?: string): Promise<void> {
  const context = getExecutionContext(startPath);
  
  switch (context) {
    case 'global-cli':
      await loadEnvironmentFiles(['~/.dexto/.env']);
      break;
    case 'dexto-project':
      const projectRoot = getDextoProjectRoot(startPath);
      await loadEnvironmentFiles([
        `${projectRoot}/.env`,
        '~/.dexto/.env'
      ]);
      break;
    case 'dexto-source':
      await loadEnvironmentFiles(['.env', '~/.dexto/.env']);
      break;
  }
}
```

```typescript
// src/core/config/loader.ts - Context-aware config loading
import { getExecutionContext, getContextDescription } from '@core/utils/execution-context.js';

export async function loadAgentConfig(configPath: string): Promise<AgentConfig> {
  const context = getExecutionContext();
  logger.debug(`Loading agent config in ${getContextDescription(context)}: ${configPath}`);
  
  // ... existing loading logic ...
}
```

```typescript
// src/core/agent/DextoAgent.ts - Context-aware storage paths
import { getExecutionContext } from '@core/utils/execution-context.js';

private getStorageBasePath(): string {
  const context = getExecutionContext();
  
  switch (context) {
    case 'global-cli':
      return getDextoGlobalPath('');
    case 'dexto-project':
      return path.join(getDextoProjectRoot()!, '.dexto');
    case 'dexto-source':
      return path.join(process.cwd(), '.dexto');
  }
}
```

## Enhanced Default Resolution
/**
 * Update default agent preference
 */
export async function updateDefaultAgentPreference(agentName: string): Promise<void> {
  // Validate agent exists first
  const registry = getAgentRegistry();
  await registry.resolveAgent(agentName); // Will throw if not found
  
  // Update preferences
  const result = await updateGlobalPreferences({
    defaults: { defaultAgent: agentName }
  });
  
  if (!result.ok) {
    throw new DextoRuntimeError(
      `Failed to update default agent preference: ${result.issues[0].message}`,
      { type: ErrorType.CONFIGURATION_ERROR }
    );
  }
  
  logger.info(`Updated default agent preference to: ${agentName}`);
}
```

## CLI Integration (Replace Old Function)

### Updated Main Function
```typescript
// src/app/index.ts - Replace resolveConfigPath() calls

import { resolveAgentPath } from '@core/config/default-resolution.js';

export async function main(): Promise<void> {
  // ... existing argument parsing ...
  
  try {
    // NEW: Use resolveAgentPath instead of resolveConfigPath
    const resolvedPath = await resolveAgentPath(configPath || options.agent);
    await runDextoAgent(resolvedPath, options);
    
  } catch (error) {
    if (error instanceof DextoRuntimeError) {
      console.error(`❌ ${error.message}`);
      
      // Show specific guidance based on error type
      if (error.context?.type === ErrorType.CONFIGURATION_ERROR) {
        console.log('🛠️  Run `dexto setup` to configure your preferences');
      }
      
      process.exit(1);
    } else {
      console.error('❌ Unexpected error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
}
```

### Set Default Agent Command
```typescript
// src/app/cli/commands/set-default.ts

import { Command } from 'commander';
import { updateDefaultAgentPreference } from '@core/config/default-resolution.js';

export function registerSetDefaultCommand(program: Command): void {
  program
    .command('set-default')
    .argument('<agent>', 'Agent name to set as default')
    .description('Set the default agent for this machine')
    .action(async (agentName: string) => {
      try {
        await updateDefaultAgentPreference(agentName);
        console.log(`✓ Default agent set to: ${agentName}`);
      } catch (error) {
        if (error instanceof DextoRuntimeError) {
          console.error(`❌ ${error.message}`);
        } else {
          console.error(`❌ Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
        }
        process.exit(1);
      }
    });
}
```

## Resolution Behavior Examples (Deterministic)

### First-Time Global User
```bash
$ dexto
❌ No global preferences found. Run `dexto setup` to get started.
🛠️  Run `dexto setup` to configure your preferences
```

### Configured Global User  
```bash
$ dexto
# Uses preferences.defaults.defaultAgent
# If agent not found in registry -> ERROR (no fallback)
```

### Dexto Project with Project Default
```bash
$ ls
dexto.config.js  default-agent.yml

$ dexto
# Uses ./default-agent.yml (project-specific)
```

### Dexto Project without Project Default
```bash
$ ls  
dexto.config.js

$ dexto
# Uses preferences.defaults.defaultAgent
# If no preferences -> ERROR (no fallback)
```

## Code Removal Plan

### Delete Old Functions
```typescript
// DELETE from src/core/utils/path.ts:
// - resolveConfigPath() function
// - Any related helper functions that are no longer used

// UPDATE all imports across codebase:
// - Change: import { resolveConfigPath } from '@core/utils/path.js';
// - To: import { resolveAgentPath } from '@core/config/default-resolution.js';
```

### Update All Callers
```typescript
// Find all usages of resolveConfigPath() and replace:
// OLD: const path = await resolveConfigPath(nameOrPath);
// NEW: const path = await resolveAgentPath(nameOrPath);

// Files likely to need updates:
// - src/app/index.ts
// - src/core/config/loader.ts (if it uses resolveConfigPath)
// - Any CLI command files
// - Any test files
```

## Testing Requirements

### Unit Tests (Fail-Fast Behavior)
```typescript
describe('resolveAgentPath', () => {
  test('throws for non-existent explicit path', async () => {
    await expect(resolveAgentPath('/nonexistent/path.yml'))
      .rejects.toThrow(DextoRuntimeError);
  });
  
  test('throws for non-existent registry agent', async () => {
    mockRegistry({});
    await expect(resolveAgentPath('nonexistent-agent'))
      .rejects.toThrow(DextoRuntimeError);
  });
  
  test('throws in global CLI context without preferences', async () => {
    mockExecutionContext('global-cli');
    mockPreferences(null);
    
    await expect(resolveAgentPath())
      .rejects.toThrow('No global preferences found');
  });
  
  test('throws in dexto-source context without bundled agent', async () => {
    mockExecutionContext('dexto-source');
    mockFileSystem({});
    
    await expect(resolveAgentPath())
      .rejects.toThrow('Bundled default agent not found');
  });
});
```

This design eliminates fallback complexity, uses existing error patterns, and provides deterministic behavior with clear error messages when things go wrong.