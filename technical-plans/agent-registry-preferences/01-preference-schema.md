# Technical Plan: Preference Schema Design

## Overview

Define the Zod schema and TypeScript types for the global preferences system. The schema must be minimal, secure, and extensible while providing clear validation errors.

## Preference File Structure

### File Location
- **Path**: `~/.dexto/preferences.yml`
- **Format**: YAML with strict validation
- **Scope**: Global only (never project-specific)

### YAML Structure
```yaml
llm:
  provider: anthropic
  model: claude-3-5-sonnet
  apiKey: $ANTHROPIC_API_KEY

defaults:
  defaultAgent: default-agent

setup:
  completed: true
```

## Zod Schema Implementation

### Core Schema Design
```typescript
// src/core/preferences/schemas.ts

import { z } from 'zod';
import { LLM_PROVIDERS } from '@core/llm/registry.js';
import { NonEmptyTrimmed } from '@core/utils/result.js';

export const PreferenceLLMSchema = z.object({
  provider: z.enum(LLM_PROVIDERS)
    .describe('LLM provider (openai, anthropic, google, etc.)'),
  
  model: NonEmptyTrimmed
    .describe('Model name for the provider'),
  
  apiKey: z.string()
    .regex(/^\$[A-Z_][A-Z0-9_]*$/, 'Must be environment variable reference (e.g., $OPENAI_API_KEY)')
    .describe('Environment variable reference for API key')
}).strict();

export const PreferenceDefaultsSchema = z.object({
  defaultAgent: z.string()
    .min(1)
    .default('default-agent')
    .describe('Default agent name for global CLI usage')
}).strict();

export const PreferenceSetupSchema = z.object({
  completed: z.boolean()
    .default(false)
    .describe('Whether initial setup has been completed')
}).strict();

export const GlobalPreferencesSchema = z.object({
  llm: PreferenceLLMSchema
    .describe('LLM configuration preferences'),
  
  defaults: PreferenceDefaultsSchema
    .default({ defaultAgent: 'default-agent' })
    .describe('Default behavior preferences'),
  
  setup: PreferenceSetupSchema
    .default({ completed: false })
    .describe('Setup completion tracking')
}).strict();

// Output types
export type PreferenceLLM = z.output<typeof PreferenceLLMSchema>;
export type PreferenceDefaults = z.output<typeof PreferenceDefaultsSchema>;
export type PreferenceSetup = z.output<typeof PreferenceSetupSchema>;
export type GlobalPreferences = z.output<typeof GlobalPreferencesSchema>;
```

### Registry Constraints Schema (Extension)
```typescript
// Extension to existing registry types
export const LLMConstraintsSchema = z.object({
  supportedProviders: z.array(z.nativeEnum(LLMProvider))
    .optional()
    .describe('Providers supported by this agent'),
  
  lockProvider: z.boolean()
    .optional()
    .describe('Whether provider is locked (cannot be overridden by preferences)')
}).strict().optional();

// Update existing RawAgentDataSchema
export const RawAgentDataSchema = z.object({
  description: z.string().describe('User-facing agent description'),
  author: z.string().describe('Agent author'),
  tags: z.array(z.string()).describe('Searchable tags'),
  source: z.string().describe('Source path (file or directory)'),
  main: z.string().optional().describe('Main entry point for directories'),
  llmConstraints: LLMConstraintsSchema.describe('LLM compatibility constraints')
}).strict();

export type LLMConstraints = z.output<typeof LLMConstraintsSchema>;
```

## Validation Requirements

### Schema Validation Rules
1. **Strict validation**: Use `.strict()` to prevent typos and unknown fields
2. **Environment variable format**: Enforce `$VAR_NAME` format (expansion handled by agent's LLMConfigSchema)
3. **Provider validation**: Must be valid LLM_PROVIDERS enum value
4. **Model validation**: Non-empty trimmed string (provider-specific validation in injection)
5. **Default agent validation**: Non-empty string (registry existence checked separately)

### Error Handling
```typescript
// Validation with clear error messages
function validatePreferences(raw: unknown): Result<GlobalPreferences, PreferenceContext> {
  const result = GlobalPreferencesSchema.safeParse(raw);
  
  if (!result.success) {
    return fail([{
      code: DextoErrorCode.PREFERENCE_VALIDATION_ERROR,
      message: 'Invalid preferences format',
      severity: 'error',
      context: { zodError: result.error }
    }]);
  }
  
  return ok(result.data);
}
```

## Security Considerations

### API Key Security
- **Enforce env var format**: Require `$VAR_NAME` pattern with regex validation
- **No environment expansion**: Preferences store unexpanded env var references
- **Safe to commit**: Preferences file contains no actual secrets, only variable names
- **Security by design**: Impossible to accidentally store plaintext API keys

### File Permissions
- **Preferences file**: Standard permissions (644) - contains no secrets
- **Environment files**: Existing multi-layer env loading (shell > project .env > global ~/.dexto/.env)

## Default Values Strategy

### Sensible Defaults
```typescript
// Built-in defaults for missing sections
defaults: {
  defaultAgent: 'default-agent'  // Always available in registry
}

setup: {
  completed: false  // Triggers first-time setup
}

// llm section is required (no defaults)
```

### Minimal Configuration
- **Required**: Only `llm` section (provider, model, apiKey)
- **Optional**: `defaults` and `setup` have sensible defaults
- **Extensible**: Easy to add new preference categories

## Integration Points

### With Existing Systems
1. **LLM Registry**: Validate provider+model combinations during injection
2. **Agent Registry**: Reference constraint schema for injection validation
3. **Config Loader**: Apply preferences during installation (not loading)
4. **First-time Setup**: Create preferences.yml instead of agent.yml

### Future Extensions
```typescript
// Placeholder for future preference categories
export const GlobalPreferencesSchema = z.object({
  llm: PreferenceLLMSchema,
  defaults: PreferenceDefaultsSchema,
  setup: PreferenceSetupSchema,
  
  // Future extensions:
  // ui: PreferenceUISchema.optional(),
  // security: PreferenceSecuritySchema.optional(),
  // telemetry: PreferenceTelemetrySchema.optional()
}).strict();
```

## File Path Constants

### New Constants
```typescript
// src/core/preferences/constants.ts
export const PREFERENCES_FILE = 'preferences.yml';

// Usage
getDextoGlobalPath(PREFERENCES_FILE)  // ~/.dexto/preferences.yml

// Environment files use existing multi-layer loading system
// No new constants needed - reuse getDextoEnvPath()
```

## Validation Testing

### Test Cases Required
1. **Valid preferences**: All fields correct
2. **Missing llm section**: Should fail validation
3. **Invalid provider**: Should fail validation  
4. **Invalid API key format**: Should fail validation (not env var)
5. **Unknown fields**: Should fail validation (.strict())
6. **Missing optional sections**: Should use defaults
7. **Empty file**: Should fail validation
8. **Malformed YAML**: Should fail parsing

### Example Valid Preferences
```yaml
# Minimal valid preferences
llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY

# Full valid preferences  
llm:
  provider: anthropic
  model: claude-3-5-sonnet
  apiKey: $ANTHROPIC_API_KEY

defaults:
  defaultAgent: custom-default

setup:
  completed: true
```

### Example Invalid Preferences
```yaml
# Invalid: plaintext API key (enforced by regex)
llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: sk-1234567890  # ❌ Must be $OPENAI_API_KEY format

# Invalid: unknown field
llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY
unknownField: value  # ❌ .strict() prevents this

# Invalid: missing required field
defaults:
  defaultAgent: my-agent  # ❌ Missing llm section
```

## Module Organization

### File Structure
```
src/core/preferences/
├── schemas.ts       # Zod schemas and TypeScript types
├── constants.ts     # File paths and constants
└── index.ts        # Public exports
```

### Public Exports
```typescript
// src/core/preferences/index.ts
export type {
  GlobalPreferences,
  PreferenceLLM,
  PreferenceDefaults,
  PreferenceSetup,
  LLMConstraints
} from './schemas.js';

export {
  GlobalPreferencesSchema,
  PreferenceLLMSchema,
  PreferenceDefaultsSchema,
  PreferenceSetupSchema,
  LLMConstraintsSchema
} from './schemas.js';

export {
  PREFERENCES_FILE
} from './constants.js';
```

This schema design provides a solid foundation for the preference system while maintaining security, clarity, and extensibility.