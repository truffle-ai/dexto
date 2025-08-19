# Technical Plan: First-Time Detection System

## Overview

Migrate from legacy file-based first-time detection (`~/.dexto/agent.yml`) to preferences-based detection (`~/.dexto/preferences.yml`). This creates a cleaner, more standardized approach that aligns with the new preference system while maintaining a smooth first-time user experience.

## Current State Analysis

### Existing First-Time Detection
```typescript
// src/app/cli/utils/first-time-setup.ts - Current approach
function isFirstTimeUserScenario(resolvedPath: string): boolean {
  return path.basename(resolvedPath) === 'agent.yml' &&
         path.dirname(resolvedPath).endsWith(path.join('.dexto', 'agents'));
}
```

**Problems with Current Approach:**
- Hardcoded path checking is brittle
- Relies on bundled `agent.yml` file location detection
- Doesn't integrate with new preference system
- Uses legacy configuration structure

## New Preferences-Based Detection

### Core Detection Logic
```typescript
// src/core/preferences/first-time-detection.ts

import { globalPreferencesExist } from './loader.js';
import { getDextoGlobalPath } from '@core/utils/path.js';
import { logger } from '@core/logger/index.js';

/**
 * Check if setup is needed (first-time user or invalid preferences)
 * @returns true if setup should be triggered
 */
export function needsSetup(): boolean {
  const hasPreferences = globalPreferencesExist();
  
  if (!hasPreferences) {
    logger.debug('Setup needed: no global preferences found');
    return true;
  }
  
  return false;
}

/**
 * Check if user needs setup (including validation of existing preferences)
 * @returns true if setup is needed
 */
export async function needsSetupGuidance(): Promise<boolean> {
  // No preferences at all - definitely needs setup
  if (needsSetup()) {
    return true;
  }
  
  // Check if preferences are valid and complete
  try {
    const preferences = await loadGlobalPreferences();
    
    // Check setup completion flag
    if (!preferences.setup.completed) {
      logger.debug('Setup needed: setup not marked as completed');
      return true;
    }
    
    // Check required fields (will throw if missing due to schema)
    if (!preferences.defaults.defaultAgent) {
      logger.debug('Setup needed: defaults.defaultAgent missing');
      return true;
    }
    
    return false;
    
  } catch (error) {
    logger.debug('Setup needed: preferences file is corrupted or invalid');
    return true;
  }
}

/**
 * Get appropriate guidance message based on user state
 */
export async function getSetupGuidanceMessage(): Promise<string> {
  if (needsSetup()) {
    return [
      '👋 Welcome to Dexto! Let\'s get you set up...',
      '',
      '🚀 Run `dexto setup` to configure your AI preferences',
      '   • Choose your AI provider (Google Gemini, OpenAI, etc.)',
      '   • Set up your API keys',
      '   • Configure your default agent',
      '',
      '💡 After setup, you can install agents with: `dexto install <agent-name>`'
    ].join('\n');
  }
  
  // Invalid, incomplete, or corrupted preferences
  return [
    '⚠️  Your Dexto preferences need attention',
    '',
    '🔧 Run `dexto setup` to fix your configuration',
    '   This will restore your AI provider settings and preferences'
  ].join('\n');
}
```

## Integration with CLI Entry Point

### Updated Main Function
```typescript
// src/app/index.ts - Enhanced first-time detection

import { 
  isFirstTimeUser, 
  needsSetupGuidance, 
  getSetupGuidanceMessage 
} from '@core/preferences/first-time-detection.js';
import { resolveConfigPath } from '@core/utils/path.js';

export async function main(): Promise<void> {
  // ... existing argument parsing ...
  
  // Handle explicit agent specification (skip first-time detection)
  if (configPath || options.agent) {
    const resolvedPath = await resolveConfigPath(configPath || options.agent);
    await runDextoAgent(resolvedPath, options);
    return;
  }
  
  // Check if user needs setup guidance
  if (await needsSetupGuidance()) {
    const guidanceMessage = await getSetupGuidanceMessage();
    console.log(guidanceMessage);
    console.log(''); // Extra spacing
    
    // For completely new users, show additional context
    if (isFirstTimeUser()) {
      console.log('🎯 Quick start options:');
      console.log('   • `dexto setup` - Complete setup wizard');
      console.log('   • `dexto --help` - See all available commands');
      console.log('');
    }
    
    process.exit(0);
  }
  
  // User has valid preferences - proceed with default agent resolution
  const defaultAgentPath = await resolveConfigPath();
  await runDextoAgent(defaultAgentPath, options);
}
```

## Legacy Migration Strategy

### Deprecating Old Detection
```typescript
// src/app/cli/utils/first-time-setup.ts - Legacy deprecation

/**
 * @deprecated Use isFirstTimeUser() from preferences/first-time-detection.js instead
 * Legacy detection based on bundled agent.yml file location
 */
export function isFirstTimeUserScenario(resolvedPath: string): boolean {
  console.warn('⚠️  Using deprecated first-time detection. This will be removed in a future version.');
  
  return path.basename(resolvedPath) === 'agent.yml' &&
         path.dirname(resolvedPath).endsWith(path.join('.dexto', 'agents'));
}

/**
 * @deprecated Use the new setup command instead: `dexto setup`
 * Legacy first-time setup workflow
 */
export async function handleFirstTimeSetup(): Promise<string> {
  console.log('🔄 Using legacy first-time setup...');
  console.log('💡 Tip: Run `dexto setup` for the improved setup experience!');
  
  // ... existing legacy setup logic ...
  
  console.log('✨ Setup complete! Next time, try `dexto setup` for a better experience.');
  return configPath;
}
```

### Migration Detection
```typescript
// src/core/preferences/migration.ts

import { existsSync } from 'fs';
import { getDextoGlobalPath } from '@core/utils/path.js';

/**
 * Check if user has legacy config that needs migration
 */
export function hasLegacyConfiguration(): boolean {
  const legacyAgentPath = getDextoGlobalPath('agent.yml');
  const legacyAgentsDir = getDextoGlobalPath('agents');
  
  return existsSync(legacyAgentPath) || existsSync(legacyAgentsDir);
}

/**
 * Suggest migration to new preferences system
 */
export function showMigrationGuidance(): void {
  console.log('📦 Legacy Dexto configuration detected');
  console.log('');
  console.log('🚀 Upgrade to the new preferences system:');
  console.log('   1. Run `dexto setup` to create modern preferences');
  console.log('   2. Your existing agents will continue working');
  console.log('   3. New features like preference injection will be available');
  console.log('');
  console.log('💡 This upgrade is recommended but not required');
}
```

## Setup Completion Tracking

### Setup State Management
```typescript
// Enhanced setup completion tracking

/**
 * Mark setup as completed in preferences
 */
export async function markSetupCompleted(preferences: GlobalPreferences): Promise<void> {
  const updatedPreferences = {
    ...preferences,
    setup: {
      ...preferences.setup,
      completed: true,
      completedAt: new Date().toISOString()
    }
  };
  
  const result = await saveGlobalPreferences(updatedPreferences);
  if (!result.ok) {
    throw new DextoRuntimeError('Failed to mark setup as completed', { 
      type: ErrorType.INTERNAL_ERROR 
    });
  }
}

/**
 * Reset setup completion state (for troubleshooting)
 */
export async function resetSetupState(): Promise<void> {
  const result = await loadGlobalPreferences();
  if (!result.ok) {
    throw new DextoRuntimeError('Cannot reset setup state: preferences not found');
  }
  
  const resetPreferences = {
    ...result.data,
    setup: {
      ...result.data.setup,
      completed: false
    }
  };
  
  await saveGlobalPreferences(resetPreferences);
  console.log('🔄 Setup state reset. Run `dexto setup` to reconfigure.');
}
```

## Error Recovery Patterns

### Corrupted Preferences Handling
```typescript
// src/core/preferences/recovery.ts

import { promises as fs } from 'fs';
import { getDextoGlobalPath } from '@core/utils/path.js';

/**
 * Handle corrupted preferences with backup and recovery
 */
export async function handleCorruptedPreferences(): Promise<void> {
  const preferencesPath = getDextoGlobalPath('preferences.yml');
  const backupPath = getDextoGlobalPath('preferences.yml.backup');
  
  console.log('⚠️  Corrupted preferences detected');
  
  try {
    // Backup corrupted file
    await fs.copyFile(preferencesPath, backupPath);
    console.log(`📦 Corrupted file backed up to: ${backupPath}`);
    
    // Remove corrupted file
    await fs.unlink(preferencesPath);
    
    console.log('🔧 Corrupted preferences removed');
    console.log('🚀 Run `dexto setup` to create fresh preferences');
    
  } catch (error) {
    console.error('❌ Failed to handle corrupted preferences:', error);
    console.log('🛠️  Manual recovery needed:');
    console.log(`   1. Delete: ${preferencesPath}`);
    console.log('   2. Run: dexto setup');
  }
}

/**
 * Validate preferences file integrity
 */
export async function validatePreferencesIntegrity(): Promise<boolean> {
  try {
    const result = await loadGlobalPreferences();
    return result.ok;
  } catch {
    return false;
  }
}
```

## CLI Command Integration

### New Reset Command
```typescript
// src/app/cli/commands/reset.ts

import { Command } from 'commander';
import { resetSetupState, handleCorruptedPreferences } from '@core/preferences/index.js';

export function registerResetCommand(program: Command): void {
  program
    .command('reset')
    .description('Reset Dexto preferences (for troubleshooting)')
    .option('--preferences', 'Reset preferences only (keep agents)')
    .option('--all', 'Reset everything (preferences + installed agents)')
    .action(async (options) => {
      if (options.all) {
        console.log('🚫 Full reset not yet implemented');
        console.log('💡 For now, delete ~/.dexto manually and run `dexto setup`');
        return;
      }
      
      if (options.preferences) {
        await resetSetupState();
        return;
      }
      
      // Default: just preferences
      await resetSetupState();
    });
}
```

## User Experience Flow

### First-Time User Journey
```
1. User runs: `dexto`
   └── No preferences.yml found
   
2. System shows welcome message:
   "👋 Welcome to Dexto! Let's get you set up..."
   
3. User runs: `dexto setup`
   └── Interactive provider selection
   └── API key configuration
   └── preferences.yml created with setup.completed = true
   
4. User runs: `dexto` (default agent)
   └── Preferences exist, load default agent
   
5. User runs: `dexto install my-agent`
   └── Preferences exist, inject LLM settings into installed agent
```

### Returning User Journey
```
1. User runs: `dexto`
   └── preferences.yml exists and valid
   └── Load default agent from preferences
   
2. User installs new agent: `dexto install new-agent`
   └── Automatically applies global preferences
```

### Error Recovery Journey
```
1. System detects corrupted preferences.yml
   
2. Shows recovery message:
   "⚠️ Your Dexto preferences need attention"
   
3. User runs: `dexto setup`
   └── Recreates preferences with current setup flow
```

## Testing Requirements

### Unit Tests
```typescript
// Tests for first-time detection
describe('First-time detection', () => {
  test('detects first-time user when no preferences exist', () => {
    mockFs({ '~/.dexto': {} }); // Empty dexto directory
    expect(isFirstTimeUser()).toBe(true);
  });
  
  test('detects returning user when preferences exist', () => {
    mockFs({ '~/.dexto/preferences.yml': validPreferences });
    expect(isFirstTimeUser()).toBe(false);
  });
  
  test('needs setup guidance when preferences corrupted', async () => {
    mockFs({ '~/.dexto/preferences.yml': 'invalid: yaml: content' });
    expect(await needsSetupGuidance()).toBe(true);
  });
  
  test('needs setup guidance when setup incomplete', async () => {
    const incompletePrefs = { ...validPreferences, setup: { completed: false }};
    mockFs({ '~/.dexto/preferences.yml': yaml.stringify(incompletePrefs) });
    expect(await needsSetupGuidance()).toBe(true);
  });
});
```

### Integration Tests
```typescript
// End-to-end first-time flow
describe('First-time user flow', () => {
  test('complete first-time setup flow', async () => {
    // Clean state
    mockFs({ '~/.dexto': {} });
    
    // Run main with no args
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation();
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    
    await main([]);
    
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Welcome to Dexto')
    );
  });
});
```

## Migration Timeline

### Phase 1: Implement New System
- Add preferences-based detection functions
- Update CLI entry point to use new detection
- Keep legacy functions available but deprecated

### Phase 2: User Communication
- Add helpful migration messages for legacy users
- Update documentation to favor new setup command
- Provide clear migration path

### Phase 3: Legacy Deprecation
- Remove legacy first-time detection code
- Clean up deprecated functions
- Ensure all tests use new system

This design creates a robust, preference-based first-time detection system that provides better user experience while enabling smooth migration from the legacy approach.