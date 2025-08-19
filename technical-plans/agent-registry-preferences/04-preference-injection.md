# Technical Plan: Preference Injection System

## Overview

Implement install-time preference injection that applies global LLM preferences to agent configurations during registry agent installation. The system preserves agent-specific settings while injecting user's provider, model, and API key preferences.

**TODO: Revisit error pattern - consider using PreferenceError factory instead of Result pattern for single injection errors.**

## Core Injection Logic

### Injection Function
```typescript
// src/core/preferences/injection.ts

import { promises as fs } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { type LLMProvider } from '@core/llm/registry.js';
import { type GlobalPreferences } from './schemas.js';
import { validateModelForProvider } from '@core/llm/registry.js';
import { logger } from '@core/logger/index.js';

export interface LLMOverrides {
  provider?: LLMProvider;
  model?: string;
  apiKey?: string;
}

/**
 * Inject global LLM preferences into an agent config file
 * @param configPath Absolute path to agent configuration file
 * @param preferences Global preferences to inject
 * @param overrides Optional CLI overrides
 */
export async function injectLLMPreferences(
  configPath: string,
  preferences: GlobalPreferences,
  overrides?: LLMOverrides
): Promise<void> {
  
  // Load raw config
  const fileContent = await fs.readFile(configPath, 'utf-8');
  const config = parseYaml(fileContent);
  
  // Determine final values (precedence: CLI > preferences > agent defaults)
  const provider = overrides?.provider ?? preferences.llm.provider;
  const model = overrides?.model ?? preferences.llm.model;
  const apiKey = overrides?.apiKey ?? preferences.llm.apiKey;
  
  // Validate provider+model compatibility
  if (!validateModelForProvider(provider, model)) {
    throw new Error(`Model '${model}' is not supported by provider '${provider}'`);
  }
  
  // Inject only core LLM fields, preserve agent-specific settings
  if (!config.llm) {
    config.llm = {};
  }
  
  config.llm = {
    ...config.llm,  // Preserve temperature, router, maxTokens, etc.
    provider,       // Inject user preference
    model,          // Inject user preference  
    apiKey          // Inject user preference
  };
  
  // Write back to file
  const yamlContent = stringifyYaml(config, { indent: 2 });
  await fs.writeFile(configPath, yamlContent, 'utf-8');
  
  logger.info(`✓ Applied preferences to: ${configPath} (${provider}/${model})`);
}
```

## Multi-Agent System Handling

### Directory-Based Injection
```typescript
// For multi-agent systems like triage-demo:
// Apply preferences to ALL .yml files during directory installation

// Installation flow:
dexto -a triage-agent 
  → installAgent('triage-agent')              # Copy entire triage-demo/ directory
  → findAllAgentConfigs(installedDir)        # Find all .yml files in directory
  → injectLLMPreferences() for each file     # Apply preferences to each config

// Example directory structure after installation:
~/.dexto/agents/triage-agent/
├── triage-agent.yml           # ✓ Preferences injected
├── technical-support-agent.yml # ✓ Preferences injected  
├── billing-agent.yml          # ✓ Preferences injected
├── escalation-agent.yml       # ✓ Preferences injected
├── product-info-agent.yml     # ✓ Preferences injected
└── docs/                      # No injection needed
```

### Multi-Agent System Handling

#### Universal Injection Function
```typescript
/**
 * Apply preferences to an installed agent (file or directory)
 * @param installedPath Path to installed agent file or directory
 * @param preferences Global preferences to inject
 * @param overrides Optional CLI overrides
 */
export async function injectPreferencesToAgent(
  installedPath: string,
  preferences: GlobalPreferences,
  overrides?: LLMOverrides
): Promise<void> {
  const stat = await fs.stat(installedPath);
  
  if (stat.isFile()) {
    // Single file agent - inject directly
    if (installedPath.endsWith('.yml') || installedPath.endsWith('.yaml')) {
      await injectLLMPreferences(installedPath, preferences, overrides);
      logger.info(`✓ Applied preferences to: ${path.basename(installedPath)}`);
    } else {
      logger.warn(`Skipping non-YAML file: ${installedPath}`);
    }
  } else if (stat.isDirectory()) {
    // Directory-based agent - inject to all .yml files
    await injectPreferencesToDirectory(installedPath, preferences, overrides);
  } else {
    throw new Error(`Invalid agent path: ${installedPath} (not file or directory)`);
  }
}

/**
 * Apply preferences to all agent configs in a directory
 * @param installedDir Directory containing agent configs
 * @param preferences Global preferences to inject
 * @param overrides Optional CLI overrides
 */
async function injectPreferencesToDirectory(
  installedDir: string,
  preferences: GlobalPreferences,
  overrides?: LLMOverrides
): Promise<void> {
  
  // Find all .yml files in the directory (recursively if needed)
  const configFiles = await findAgentConfigFiles(installedDir);
  
  if (configFiles.length === 0) {
    logger.warn(`No YAML config files found in: ${installedDir}`);
    return;
  }
  
  // Apply preferences to each config file
  let successCount = 0;
  for (const configPath of configFiles) {
    try {
      await injectLLMPreferences(configPath, preferences, overrides);
      logger.debug(`Applied preferences to: ${path.relative(installedDir, configPath)}`);
      successCount++;
    } catch (error) {
      logger.warn(`Failed to inject preferences to ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
      // Continue with other files
    }
  }
  
  logger.info(`✓ Applied preferences to ${successCount}/${configFiles.length} config files`);
}

/**
 * Find all agent configuration files in a directory
 */
async function findAgentConfigFiles(dir: string): Promise<string[]> {
  const configFiles: string[] = [];
  
  async function walkDir(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      if (entry.isDirectory()) {
        // Skip docs and data directories
        if (!['docs', 'data'].includes(entry.name)) {
          await walkDir(fullPath);
        }
      } else if (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) {
        configFiles.push(fullPath);
      }
    }
  }
  
  await walkDir(dir);
  return configFiles;
}
```

### Template Variable Integration
- **Template variables work correctly**: `${{dexto.agent_dir}}` expands to the installed directory
- **All sub-agents work**: File paths resolve correctly after installation
- **Consistent preferences**: All configs in the system use the same LLM preferences

This approach is much simpler and more reliable than trying to track registry vs file-based sub-agents!