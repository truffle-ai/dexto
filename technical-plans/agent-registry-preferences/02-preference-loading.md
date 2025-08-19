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
import { DextoValidationError, DextoRuntimeError, ErrorType } from '@core/errors/index.js';
import { type LLMProvider } from '@core/llm/registry.js';
import { GlobalPreferencesSchema, type GlobalPreferences } from './schemas.js';
import { PREFERENCES_FILE } from './constants.js';

/**
 * Load global preferences from ~/.dexto/preferences.yml
 * @returns Global preferences object
 * @throws DextoRuntimeError if file not found or corrupted
 * @throws DextoValidationError if preferences are invalid
 */
export async function loadGlobalPreferences(): Promise<GlobalPreferences> {
  const preferencesPath = getDextoGlobalPath(PREFERENCES_FILE);
  
  // Check if preferences file exists
  if (!existsSync(preferencesPath)) {
    throw PreferenceError.fileNotFound(preferencesPath);
  }

  try {
    // Read and parse YAML
    const fileContent = await fs.readFile(preferencesPath, 'utf-8');
    const rawPreferences = parseYaml(fileContent);
    
    // Validate with schema
    const validation = GlobalPreferencesSchema.safeParse(rawPreferences);
    if (!validation.success) {
      throw PreferenceError.validationFailed(validation.error);
    }
    
    logger.debug(`Loaded global preferences from: ${preferencesPath}`);
    return validation.data;
    
  } catch (error) {
    if (error instanceof DextoValidationError || error instanceof DextoRuntimeError) {
      throw error; // Re-throw our own errors
    }
    
    throw PreferenceError.fileReadError(preferencesPath, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Save global preferences to ~/.dexto/preferences.yml
 * @param preferences Validated preferences object
 * @throws DextoRuntimeError if write fails
 */
export async function saveGlobalPreferences(preferences: GlobalPreferences): Promise<void> {
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
    
  } catch (error) {
    throw PreferenceError.fileWriteError(preferencesPath, error instanceof Error ? error.message : String(error));
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
 * @returns Updated preferences object
 * @throws DextoRuntimeError if load/save fails
 * @throws DextoValidationError if merged preferences are invalid
 */
export async function updateGlobalPreferences(
  updates: Partial<GlobalPreferences>
): Promise<GlobalPreferences> {
  // Load existing preferences
  const existing = await loadGlobalPreferences();
  
  // Merge updates
  const merged = {
    ...existing,
    ...updates,
    // Deep merge for nested objects
    llm: { ...existing.llm, ...updates.llm },
    defaults: { ...existing.defaults, ...updates.defaults },
    setup: { ...existing.setup, ...updates.setup }
  };
  
  // Validate merged result
  const validation = GlobalPreferencesSchema.safeParse(merged);
  if (!validation.success) {
    throw PreferenceError.validationFailed(validation.error);
  }
  
  // Save updated preferences
  await saveGlobalPreferences(validation.data);
  
  return validation.data;
}
```

## Error Factory

```typescript
// src/core/preferences/errors.ts

import { DextoRuntimeError, DextoValidationError } from '@core/errors/index.js';
import { ErrorScope, ErrorType } from '@core/errors/types.js';
import { type ZodError } from 'zod';

export enum PreferenceErrorCode {
  FILE_NOT_FOUND = 'preference_file_not_found',
  FILE_READ_ERROR = 'preference_file_read_error', 
  FILE_WRITE_ERROR = 'preference_file_write_error',
  VALIDATION_ERROR = 'preference_validation_error'
}

export class PreferenceError {
  static fileNotFound(preferencesPath: string) {
    return new DextoRuntimeError(
      PreferenceErrorCode.FILE_NOT_FOUND,
      ErrorScope.PREFERENCE,
      ErrorType.USER,
      `Preferences file not found: ${preferencesPath}`,
      { preferencesPath },
      'Run `dexto setup` to create preferences'
    );
  }

  static fileReadError(preferencesPath: string, cause: string) {
    return new DextoRuntimeError(
      PreferenceErrorCode.FILE_READ_ERROR,
      ErrorScope.PREFERENCE,
      ErrorType.SYSTEM,
      `Failed to read preferences: ${cause}`,
      { preferencesPath, cause },
      'Check file permissions and ensure the file is not corrupted'
    );
  }

  static fileWriteError(preferencesPath: string, cause: string) {
    return new DextoRuntimeError(
      PreferenceErrorCode.FILE_WRITE_ERROR,
      ErrorScope.PREFERENCE,
      ErrorType.SYSTEM,
      `Failed to save preferences: ${cause}`,
      { preferencesPath, cause },
      'Check file permissions and available disk space'
    );
  }

  static validationFailed(zodError: ZodError) {
    const issues = zodError.issues.map(issue => ({
      code: PreferenceErrorCode.VALIDATION_ERROR,
      message: `${issue.path.join('.')}: ${issue.message}`,
      severity: 'error' as const
    }));
    
    return new DextoValidationError(issues);
  }
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

### Direct Exception Integration  
```typescript
// Simple exception handling
try {
  const preferences = await loadGlobalPreferences();
  // Use preferences directly
} catch (error) {
  if (error instanceof DextoRuntimeError) {
    // Handle runtime errors (file not found, permissions, etc.)
  } else if (error instanceof DextoValidationError) {
    // Handle validation errors (invalid YAML structure)
  }
}
```

## Error Handling Strategy

### File System Errors
- **File not found**: Throw PreferenceError.fileNotFound() (triggers first-time setup)
- **Permission errors**: Throw PreferenceError.fileReadError()/fileWriteError() with context
- **Directory creation**: Auto-create `~/.dexto/` if missing

### Validation Errors  
- **Schema validation**: Throw PreferenceError.validationFailed() with Zod error details
- **Provider validation**: Validate against LLM_PROVIDERS enum (built into schema)
- **Model validation**: Basic string validation (detailed validation during injection)

## Usage Examples

### Basic Loading
```typescript
import { loadGlobalPreferences } from '@core/preferences/loader.js';

try {
  const preferences = await loadGlobalPreferences();
  const { provider, model, apiKey } = preferences.llm;
  console.log(`Using ${provider}/${model} with key ${apiKey}`);
} catch (error) {
  console.error('Failed to load preferences:', error.message);
}
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
await saveGlobalPreferences(preferences);
console.log('Setup complete!');
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