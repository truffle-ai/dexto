# Technical Plan: Enhanced Default Agent Resolution

## Overview

Replace the existing `resolveConfigPath()` function with a new preference-aware default resolution system. The new system fails fast with clear errors instead of silent fallbacks, uses existing Dexto error classes, and provides deterministic behavior across execution contexts.


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

## Context Detection (Simplified)

```typescript
/**
 * Detect execution context - deterministic, no guessing
 */
function detectExecutionContext(): 'dexto-source' | 'dexto-project' | 'global-cli' {
  // Check for Dexto source context
  const dextoSourceRoot = getDextoSourceRoot();
  if (dextoSourceRoot && process.cwd().startsWith(dextoSourceRoot)) {
    return 'dexto-source';
  }
  
  // Check for Dexto project context
  if (getDextoProjectRoot()) {
    return 'dexto-project';
  }
  
  // Default to global CLI context
  return 'global-cli';
}

function getDextoSourceRoot(): string | null {
  try {
    const packageJsonPath = findUp('package.json', { cwd: process.cwd() });
    if (packageJsonPath) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      if (packageJson.name === 'dexto') {
        return path.dirname(packageJsonPath);
      }
    }
  } catch {
    // Ignore detection errors
  }
  return null;
}
```

## Preference Integration (Simple)

```typescript
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