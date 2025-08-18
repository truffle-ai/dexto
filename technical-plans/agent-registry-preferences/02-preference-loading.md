# Technical Plan: Preference Loading Utilities

## Overview

Implement utilities for loading, saving, and validating global preferences from `~/.dexto/preferences.yml`. These utilities provide the foundation for the preference system and are used by setup commands, injection logic, and first-time detection.

## Module Structure

### File Organization
```
src/core/preferences/
├── schemas.ts       # Zod schemas (from 01-preference-schema.md)
├── loader.ts        # Load/save/validate utilities (this document)
├── constants.ts     # File paths and constants
└── index.ts        # Public exports
```

## Core Loading Functions

### Preference File Loading
```typescript
// src/core/preferences/loader.ts

import { existsSync } from 'fs';
import { promises as fs } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { getDextoGlobalPath } from '@core/utils/path.js';
import { logger } from '@core/logger/index.js';
import { Result, ok, fail, zodToIssues } from '@core/utils/result.js';
import { type LLMProvider } from '@core/llm/registry.js';
import { GlobalPreferencesSchema, type GlobalPreferences } from './schemas.js';
import { PREFERENCES_FILE } from './constants.js';

/**
 * Load global preferences from ~/.dexto/preferences.yml
 * @returns Result with preferences or validation errors
 */
export async function loadGlobalPreferences(): Promise<Result<GlobalPreferences, PreferenceContext>> {
  const preferencesPath = getDextoGlobalPath(PREFERENCES_FILE);
  
  // Check if preferences file exists
  if (!existsSync(preferencesPath)) {
    return fail([{
      code: DextoErrorCode.PREFERENCE_FILE_NOT_FOUND,
      message: `Preferences file not found: ${preferencesPath}`,
      severity: 'error',
      context: { path: preferencesPath }
    }]);
  }

  try {
    // Read and parse YAML
    const fileContent = await fs.readFile(preferencesPath, 'utf-8');
    const rawPreferences = parseYaml(fileContent);
    
    // Validate with schema
    const validation = GlobalPreferencesSchema.safeParse(rawPreferences);
    if (!validation.success) {
      return fail(zodToIssues(validation.error, 'error'));
    }
    
    logger.debug(`Loaded global preferences from: ${preferencesPath}`);
    return ok(validation.data);
    
  } catch (error) {
    return fail([{
      code: DextoErrorCode.PREFERENCE_FILE_READ_ERROR,
      message: `Failed to read preferences: ${error instanceof Error ? error.message : String(error)}`,
      severity: 'error',
      context: { path: preferencesPath, error: String(error) }
    }]);
  }
}

/**
 * Save global preferences to ~/.dexto/preferences.yml
 * @param preferences Validated preferences object
 */
export async function saveGlobalPreferences(preferences: GlobalPreferences): Promise<Result<void, PreferenceContext>> {
  const preferencesPath = getDextoGlobalPath(PREFERENCES_FILE);
  
  try {
    // Ensure ~/.dexto directory exists
    const dextoDir = getDextoGlobalPath('');
    await fs.mkdir(dextoDir, { recursive: true });
    
    // Convert to YAML with nice formatting
    const yamlContent = stringifyYaml(preferences, {
      indent: 2,
      lineWidth: 100,
      minContentWidth: 20
    });
    
    // Write to file
    await fs.writeFile(preferencesPath, yamlContent, 'utf-8');
    
    logger.info(`✓ Saved global preferences to: ${preferencesPath}`);
    return ok(undefined);
    
  } catch (error) {
    return fail([{
      code: DextoErrorCode.PREFERENCE_FILE_WRITE_ERROR,
      message: `Failed to save preferences: ${error instanceof Error ? error.message : String(error)}`,
      severity: 'error',
      context: { path: preferencesPath, error: String(error) }
    }]);
  }
}
```

### Synchronous Check Functions
```typescript
/**
 * Check if global preferences exist (for first-time detection)
 * @returns true if preferences.yml exists
 */
export function globalPreferencesExist(): boolean {
  const preferencesPath = getDextoGlobalPath(PREFERENCES_FILE);
  return existsSync(preferencesPath);
}

/**
 * Get global preferences file path
 * @returns Absolute path to preferences.yml
 */
export function getGlobalPreferencesPath(): string {
  return getDextoGlobalPath(PREFERENCES_FILE);
}
```

## Helper Functions

### Preference Creation
```typescript
/**
 * Create initial preferences from setup data
 * @param provider Selected LLM provider
 * @param model Selected model
 * @param apiKeyVar Environment variable name for API key
 * @param defaultAgent Optional default agent name
 */
export function createInitialPreferences(
  provider: LLMProvider,
  model: string, 
  apiKeyVar: string,
  defaultAgent: string = 'default-agent'
): GlobalPreferences {
  return {
    llm: {
      provider,
      model,
      apiKey: `$${apiKeyVar}`
    },
    defaults: {
      defaultAgent
    },
    setup: {
      completed: true
    }
  };
}
```

### Preference Updates
```typescript
/**
 * Update specific preference sections
 * @param updates Partial preference updates
 */
export async function updateGlobalPreferences(
  updates: Partial<GlobalPreferences>
): Promise<Result<GlobalPreferences, PreferenceContext>> {
  // Load existing preferences
  const existingResult = await loadGlobalPreferences();
  if (!existingResult.ok) {
    return existingResult;
  }
  
  // Merge updates
  const merged = {
    ...existingResult.data,
    ...updates,
    // Deep merge for nested objects
    llm: { ...existingResult.data.llm, ...updates.llm },
    defaults: { ...existingResult.data.defaults, ...updates.defaults },
    setup: { ...existingResult.data.setup, ...updates.setup }
  };
  
  // Validate merged result
  const validation = GlobalPreferencesSchema.safeParse(merged);
  if (!validation.success) {
    return fail(zodToIssues(validation.error, 'error'));
  }
  
  // Save updated preferences
  const saveResult = await saveGlobalPreferences(validation.data);
  if (!saveResult.ok) {
    return saveResult;
  }
  
  return ok(validation.data);
}
```

## Error Codes and Context

### New Error Codes
```typescript
// Add to existing DextoErrorCode enum
export enum DextoErrorCode {
  // ... existing codes ...
  
  // Preference system errors
  PREFERENCE_FILE_NOT_FOUND = 'preference_file_not_found',
  PREFERENCE_FILE_READ_ERROR = 'preference_file_read_error', 
  PREFERENCE_FILE_WRITE_ERROR = 'preference_file_write_error',
  PREFERENCE_VALIDATION_ERROR = 'preference_validation_error',
  PREFERENCE_PROVIDER_MISMATCH = 'preference_provider_mismatch',
  PREFERENCE_CONSTRAINT_VIOLATION = 'preference_constraint_violation'
}
```

### Context Type
```typescript
// Context for preference-related errors
export interface PreferenceContext {
  path?: string;
  provider?: string;
  model?: string;
  agentName?: string;
  constraint?: string;
  error?: string;
  zodError?: ZodError;
}
```

## Integration with Existing Systems

### File Path Integration
```typescript
// Reuse existing getDextoGlobalPath utility
const preferencesPath = getDextoGlobalPath('preferences.yml');
// Returns: ~/.dexto/preferences.yml (always global, never project-relative)
```

### Environment Integration
```typescript
// Preferences store env var references, agent loading expands them
preferences.llm.apiKey = '$OPENAI_API_KEY';  // Stored in preferences

// During injection into agent config:
agentConfig.llm.apiKey = preferences.llm.apiKey;  // Still '$OPENAI_API_KEY'

// During agent loading:
const config = await loadAgentConfig(configPath);  // EnvExpandedString() expands to actual key
```

### Result Pattern Integration
```typescript
// Follow existing Result<T,C> pattern
const result = await loadGlobalPreferences();
if (!result.ok) {
  // Handle error cases - use existing DextoValidationError
  throw new DextoValidationError(result.issues);
}

// Use the data
const preferences = result.data;
```

## Error Handling Strategy

### File System Errors
- **File not found**: Return specific error code (triggers first-time setup)
- **Permission errors**: Return read/write error with context
- **Directory creation**: Auto-create `~/.dexto/` if missing

### Validation Errors
- **Schema validation**: Convert Zod errors to Issue format
- **Provider validation**: Validate against LLM_PROVIDERS enum
- **Model validation**: Basic string validation (detailed validation during injection)

### Recovery Strategies
```typescript
// Graceful degradation for corrupted preferences
export async function loadGlobalPreferencesWithRecovery(): Promise<Result<GlobalPreferences, PreferenceContext>> {
  const result = await loadGlobalPreferences();
  
  if (!result.ok) {
    const isCorrupted = result.issues.some(issue => 
      issue.code === DextoErrorCode.PREFERENCE_VALIDATION_ERROR
    );
    
    if (isCorrupted) {
      logger.warn('Corrupted preferences detected, backing up and prompting for reset');
      // TODO: Backup corrupted file and trigger fresh setup
    }
  }
  
  return result;
}
```

## Usage Examples

### Basic Loading
```typescript
import { loadGlobalPreferences } from '@core/preferences/loader.js';

const result = await loadGlobalPreferences();
if (!result.ok) {
  console.error('Failed to load preferences:', result.issues);
  return;
}

const { provider, model, apiKey } = result.data.llm;
console.log(`Using ${provider}/${model} with key ${apiKey}`);
```

### First-Time Detection
```typescript
import { globalPreferencesExist } from '@core/preferences/loader.js';

if (!globalPreferencesExist()) {
  console.log('First-time setup required');
  await runFirstTimeSetup();
}
```

### Setup Integration
```typescript
import { createInitialPreferences, saveGlobalPreferences } from '@core/preferences/loader.js';

// During first-time setup
const preferences = createInitialPreferences('openai', 'gpt-4o-mini', 'OPENAI_API_KEY');
const result = await saveGlobalPreferences(preferences);

if (!result.ok) {
  throw new Error(`Setup failed: ${result.issues[0].message}`);
}
```

## Testing Requirements

### Unit Tests
- **File existence**: Test `globalPreferencesExist()` with/without file
- **Loading**: Test valid/invalid YAML, missing files, permission errors
- **Saving**: Test successful saves, directory creation, permission errors
- **Validation**: Test schema validation with various invalid inputs
- **Updates**: Test partial updates and merging logic

### Integration Tests
- **Multi-layer env**: Test interaction with existing environment loading
- **Cross-platform**: Test path resolution on Windows/Mac/Linux
- **Concurrent access**: Test multiple processes accessing preferences

### Error Scenarios
- **Corrupted YAML**: Malformed preferences file
- **Invalid schema**: Wrong data types, unknown fields
- **File system**: Permission denied, disk full, network drives
- **Recovery**: Backup and reset corrupted preferences

This loader design provides robust preference management while integrating cleanly with existing Dexto patterns and error handling.