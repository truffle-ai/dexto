# Feature Plan: Enhanced Agent Registry System with Preferences

## Overview

Building on the core agent registry system, this enhancement adds global preference management and improved user experience. The system eliminates legacy config paths in favor of a unified registry-based approach with preference injection.

## Current State (From Registry System 1)

### ✅ What Works
- Agent resolution (names vs paths)  
- Template variables (`${{dexto.agent_dir}}`)
- Auto-installation on first use
- Registry loading and validation
- Multi-agent systems (triage-demo)

### 🔄 What Needs Enhancement  
- LLM preferences are hardcoded in agent configs
- Default agent uses legacy `~/.dexto/agent.yml` path
- No global preference management
- No preference injection during installation
- Limited non-interactive mode support

## Goals

### 1. **Unified Registry-Based System**
- **BREAKING**: Remove `~/.dexto/agent.yml` legacy path
- Default `dexto` command uses `default-agent` from registry
- All agents follow same installation pattern
- Clean, consistent file structure

### 2. **Global Preference Management**
- Store user LLM preferences in `~/.dexto/preferences.yml`
- Apply preferences during agent installation (one-time injection)
- Users can modify installed agent configs directly

### 3. **Enhanced Auto-Installation**
- Apply global preferences during auto-installation
- Interactive preference setup when needed
- Strict non-interactive mode for CI/automation

### 4. **Reusable Utilities**
- Extract common setup/preference logic
- Shared utilities across commands
- Clean separation of concerns

## User Flows

### Fresh Install Flow (Auto-Setup)
```bash
npm install -g dexto
dexto -a database-agent
# Auto-triggers:
# 1. Setup preferences (choose provider interactively)
# 2. Install database-agent with preferences applied  
# 3. Execute database-agent
```

### Default Agent Flow (No -a Flag)
```bash
dexto "help me with tasks"
# Uses: ~/.dexto/agents/default-agent/agent.yml
# (Installed from registry with user's preferences)
```

### Power User Flow
```bash
dexto setup --llm-provider anthropic --model claude-3-5-sonnet --no-interactive
dexto install database-agent music-agent triage-agent  # Bulk install with preferences
dexto -a database-agent "show me users"                # Fast execution
```

### CI/Automation Flow
```bash
dexto setup --llm-provider openai --no-interactive  # Required: explicit args
dexto -a database-agent "SELECT * FROM users" --no-interactive
# Fails if preferences not set and --no-interactive is used
```

## Technical Architecture

### 1. Enhanced Preference Structure

```yaml
# ~/.dexto/preferences.yml
llm:
  provider: openai
  model: gpt-4o-mini  
  apiKey: $OPENAI_API_KEY

defaults:
  defaultAgent: default-agent  # Customizable default for global CLI

setup:
  completed: true
```

**Design Principles:**
- **Minimal**: Only essential preferences, no feature flags
- **YAML**: Consistent with rest of Dexto, supports comments
- **Environment references**: API keys via env vars
- **Customizable defaults**: Power users can set different default agent
- **Version tracking**: Simple completed flag

### 2. Enhanced Command Structure

#### `dexto` (Default Command - Enhanced)
```typescript
// When no -a flag provided (global CLI context):
// 1. Load preferences, get defaults.defaultAgent (fallback: 'default-agent')
// 2. Check if specified default agent installed
// 3. If not, auto-install with preferences  
// 4. Execute default agent
```

#### `dexto setup`  
```typescript
program
  .command('setup')
  .description('Configure global Dexto preferences')
  .option('--llm-provider <provider>', 'Set default LLM provider')
  .option('--model <model>', 'Set default model') 
  .option('--no-interactive', 'Fail if required args missing')
  .action(async (opts) => {
    await setupCommand(opts);
  });
```

#### Enhanced `dexto -a <agent>` (Auto-Install with Preferences)
```typescript
// Current auto-install enhanced to apply preferences:
// 1. Check if preferences exist, setup if needed
// 2. Install agent with preference injection
// 3. Execute agent
// Note: this will only happen if agent is not already installed. console logs will make this clear
```


### 3. Preference Injection During Installation

```typescript
async function installAgentWithPreferences(
  agentName: string, 
  options: InstallOptions
): Promise<string> {
  // 1. Standard atomic installation (existing logic)
  const configPath = await installAgentFiles(agentName);
  
  // 2. Load global preferences
  const globalPrefs = await loadGlobalPreferences();
  
  // 3. Apply preference injection
  await injectLLMPreferences(configPath, globalPrefs, options.overrides);
  
  return configPath;
}

async function injectLLMPreferences(
  configPath: string,
  globalPrefs: GlobalPreferences, 
  overrides?: LLMOverrides
): Promise<void> {
  const config = await loadRawYAML(configPath);
  
  const provider = overrides?.provider || globalPrefs.llm.provider;
  const model = overrides?.model || globalPrefs.llm.model;
  
  // Inject ONLY llm core fields, preserve agent-specific settings
  config.llm = {
    ...config.llm,  // Keep temperature, router, maxTokens, etc.
    provider,       // Inject user preference
    model,          // Inject user preference  
    apiKey: globalPrefs.llm.apiKey  // Inject user API key
  };
  
  // Validate provider+model compatibility
  validateModelForProvider(provider, model);
  
  await writeRawYAML(configPath, config);
}
```

### 4. Enhanced First-Time Detection

#### Current Detection (Bundled Config Based)
```typescript
export function isFirstTimeUserScenario(configPath: string): boolean {
    if (isDextoSourceCode()) return false;
    return isUsingBundledConfig(configPath);  // Checks if using bundled config
}
```

#### New Detection (Preference Based)
```typescript
export function isFirstTimeUserScenario(): boolean {
    if (isDextoSourceCode()) return false;
    
    // Check if global preferences exist (universal trigger)
    const preferencesPath = getDextoGlobalPath('preferences.yml');
    return !existsSync(preferencesPath);
}
```

**Benefits:**
- Universal: Works for any command (`dexto`, `dexto -a agent`, `dexto install`)
- Simple: Single source of truth for setup completion
- Clean: No dependency on config path resolution

#### Integration with CLI
```typescript
// In index.ts, before any agent loading:
if (isFirstTimeUserScenario()) {
    if (opts.noInteractive) {  // Consistent --no-interactive flag
        throw new Error('First-time setup required but --no-interactive flag is set');
    }
    
    await handleFirstTimeSetup();  // Creates preferences.yml
}

// Then proceed with agent loading (preferences now available)
const config = await loadAgentConfig(opts.agent);
```

### 5. Enhanced Default Resolution

#### Current Default Resolution
```typescript
// Current: resolveConfigPath() when no -a flag
// 1. Check ~/.dexto/agent.yml  
// 2. Fall back to bundled agents/agent.yml
```

#### New Default Resolution (Global CLI)
```typescript
// New: loadAgentConfig() when no -a flag (global context)
// 1. Load preferences, get defaults.defaultAgent (fallback: 'default-agent')
// 2. Auto-install specified default agent with preferences (if needed)
// 3. Use ~/.dexto/agents/{defaultAgent}/ or ~/.dexto/agents/{defaultAgent}.yml
// 4. No more legacy ~/.dexto/agent.yml
```

#### Project Default Resolution (Unchanged Scope)
```typescript
// In project context: loadAgentConfig() when no -a flag
// 1. Look for src/dexto/agents/default-agent.yml (consistent naming)
// 2. No preference injection (project isolation)
// 3. Development workflow preserved
```

## Project Context Behavior

### Dexto Projects vs Global CLI

The system must handle both global CLI usage and project-based development:

#### Global CLI Context (Outside Projects)
```bash
# Uses global preferences and registry agents
dexto                    # → default-agent with global preferences  
dexto -a database-agent  # → Registry agent with global preferences
```

#### Project Context (Inside `dexto create-app` Projects)
```bash
cd my-dexto-project

# Uses project default-agent (consistent naming)
dexto                    # → ./src/dexto/agents/default-agent.yml (NEW: consistent naming)

# Registry agents still available (with global preferences)
dexto -a database-agent  # → ~/.dexto/agents/database-agent/ or ~/.dexto/agents/database-agent.yml 

# Local files work (unchanged)
dexto -a ./custom.yml    # → Project file
```

#### Resolution Logic Enhancement
// this is weird and we might need to revisit this
```typescript
loadAgentConfig(nameOrPath) {
  if (!nameOrPath) {
    // Context-aware default resolution
    if (isDextoProject()) {
      // In project: use project config (preserve dev workflow)
      return resolveConfigPath(nameOrPath);
    } else {
      // Global CLI: use default-agent from registry
      return registry.resolveAgent('default-agent');
    }
  } else if (isPath(nameOrPath)) {
    // File paths work everywhere (unchanged)
    return resolveConfigPath(nameOrPath);
  } else {
    // Registry names work everywhere
    return registry.resolveAgent(nameOrPath);
  }
}
```

**Design Principles:**
- **Project isolation**: Global preferences don't affect project development
- **Registry access**: Registry agents available everywhere
- **Development workflow**: Project configs remain customizable
- **Preference scope**: Global preferences only apply to globally-executed agents

## Implementation Plan

### Phase 1: Preference Infrastructure
- [x] **1.1 Create preference schema** - Minimal YAML structure with validation
- [x] **1.2 Add preference loading utilities** - Load/save/validate preferences.yml
- [x] **1.3 Extract setup utilities** - Reusable provider selection, API key setup
- [x] **1.4 Create preference injection utilities** - Apply prefs to agent configs

### Phase 2: Command Implementation
- [x] **2.1 Create dexto setup command** - Interactive and non-interactive modes
- [x] **2.2 Add auto-setup trigger** - Run setup on first command if needed
- [x] **2.3 Enhance auto-installation** - Apply preferences during installation
- [x] **2.4 Update default agent resolution** - Use default-agent from registry
- [x] **2.5 Path resolution cleanup** - Remove legacy resolveConfigPath, consolidate execution context detection, update all imports and tests

### Phase 3: Integration & Polish
- [x] **3.1 Add bulk installation support** - Multiple agents in single command
- [ ] **3.2 Enhance error handling** - Clear messages for missing preferences/registry stuff
- [ ] **3.3 Add validation and recovery** - Handle corrupted preferences
- [ ] **3.4 Update first-time setup integration** - Use new preference system

### Phase 4: Project Integration
- [ ] **4.1 Update dexto create-app** - Generate `src/dexto/agents/default-agent.yml` instead of `agent.yml`
- [ ] **4.2 Update path resolution** - Look for `default-agent.yml` in project search paths
- [ ] **4.3 Test project workflows** - Ensure consistent naming doesn't break development

### Phase 5: Enhanced CLI Commands
- [ ] **5.1 Add dexto install command** - Explicit bulk installation with preference control
- [ ] **5.2 Add dexto update-agent command** - Interactive CLI to update any part of agent (initially: reapply preferences)
- [ ] **5.3 Enhance list-agents command** - Show installation and preference status
- [ ] **5.4 Add which command** - Debug resolution with preference info

### Phase 6: Testing & Migration  
- [ ] **6.1 Cross-platform testing** - Windows, Mac, Linux path handling
- [ ] **6.2 Multi-agent system testing** - triage-demo with preferences and sub-agents  
- [ ] **6.3 Edge case testing** - All scenarios with preference combinations
- [ ] **6.4 Error message polish** - Clear, helpful messages with preference context
- [ ] **6.5 Migration utilities** - Convert existing ~/.dexto/agent.yml to preferences
- [ ] **6.6 Documentation updates** - User guides for new preference workflow
- [ ] **6.7 Breaking change communication** - Clear migration guide
- [ ] **6.8 Rename preferences to settings** - Rename module, file, and all references from "preferences" to "settings" for industry standard terminology

## Enhanced CLI Command Examples

### dexto install (Explicit Bulk Installation)
```bash
dexto install database-agent music-agent triage-agent  # Bulk install
dexto install database-agent --llm-provider anthropic  # Override for this agent
dexto install database-agent --no-interactive          # Fail if prefs missing
```

### dexto update-agent (Interactive Agent Management)
```bash
dexto update-agent database-agent                    # Interactive: LLM, description, etc.
dexto update-agent database-agent --reapply-prefs    # Reapply global preferences only
dexto update-agent database-agent --dry-run          # Show what would change
```

### dexto which (Enhanced Debugging)
```bash
dexto which database-agent
# → Path: ~/.dexto/agents/database-agent/database-agent.yml
# → LLM: OpenAI gpt-4o-mini (from global preferences)
# → Installed: 2025-08-18 16:11
```

### dexto list-agents (Enhanced Status)
```bash
dexto list-agents
# Installed (with preference status):
# • database-agent (OpenAI gpt-4o-mini) - AI agent for database operations
# • triage-agent (Anthropic claude-3-5-sonnet) - Customer support triage
# 
# Available to Install:
# • music-agent - AI agent for music creation
# • image-editor - AI agent for image editing
```

## Implementation Scope & Precedence

### Preference Precedence (Install-Time Only)
```
CLI overrides > Global preferences > Agent defaults
```

### Injection Scope (Minimal)
**ONLY inject**: `llm.provider`, `llm.model`, `llm.apiKey`
**NEVER touch**: `llm.temperature`, `llm.router`, `llm.maxTokens`, etc.

### Multi-Agent Systems
- **Registry sub-agents**: Get preference injection at their own install time
- **File path sub-agents**: No preference injection (project isolation)

## Detailed Implementation

### Preference Injection Logic
```typescript
// During installation, merge preferences intelligently:
const agentConfig = {
  llm: {
    provider: "openai",      // From agent config
    model: "gpt-4o-mini",    // From agent config  
    temperature: 0.1         // Agent-specific (preserve)
  }
};

const userPreferences = {
  llm: {
    provider: "anthropic",   // User's choice
    model: "claude-3-5-sonnet"
  }
};

// Result after injection:
const finalConfig = {
  llm: {
    provider: "anthropic",   // User preference wins
    model: "claude-3-5-sonnet", // User preference wins
    temperature: 0.1,        // Agent-specific preserved
    apiKey: "$ANTHROPIC_API_KEY"  // User's env var
  }
};
```

### Non-Interactive Mode Behavior
```bash
# Interactive mode (default):
dexto setup
# → Shows provider picker if provider not specified

# Non-interactive mode:  
dexto setup --no-interactive
# → Fails if --llm-provider not specified

dexto setup --llm-provider openai --no-interactive  
# → Succeeds, uses defaults for model, etc.
```

### Default Agent Resolution Change
```typescript
// Current loadAgentConfig logic:
if (!nameOrPath) {
    absolutePath = resolveConfigPath(nameOrPath);  // Legacy behavior
}

// New loadAgentConfig logic:
if (!nameOrPath) {
    // Use default-agent from registry instead of file resolution
    const registry = new LocalAgentRegistry();
    absolutePath = await registry.resolveAgent('default-agent');
    logger.debug(`Using registry default-agent: ${absolutePath}`);
}
```

## Migration Impact (Breaking Changes)

### What Breaks
1. **`~/.dexto/agent.yml` no longer used** as default
2. **First-time setup** creates preferences.yml instead of agent.yml
3. **Default behavior** installs default-agent to `~/.dexto/agents/default-agent/`

### Migration Path
1. **Detection**: Check if `~/.dexto/agent.yml` exists and no preferences.yml
2. **Migration**: Extract LLM config from agent.yml → preferences.yml
3. **Installation**: Install default-agent with extracted preferences
4. **Cleanup**: Remove old agent.yml (optional)

## Code Organization & Module Structure

### Simplified Module Structure
```
src/core/preferences/       # Simple preference management
├── schemas.ts             # Zod validation for preferences.yml
├── loader.ts             # Load/save/validate preferences.yml
├── injection.ts          # Apply preferences to agent configs during install
└── index.ts

src/core/agent-registry/    # Agent registry functionality
├── registry.ts           # Agent resolution and installation
├── types.ts             # Registry types
└── index.ts

src/app/cli/global-commands/       # CLI commands with full setup logic
├── setup.ts             # Interactive setup + provider selection + API keys
├── install.ts          # Install agents with preference injection
└── index.ts
```

**Benefits:**
- **Simple boundaries**: Core handles data, CLI handles interaction
- **No premature abstraction**: No "reusable" setup utilities until needed
- **Clear responsibilities**: Preferences = data management, Commands = user workflows
- **YAGNI principle**: Don't build Web UI abstractions until required

## Success Metrics

### Phase 1 Complete When:
- Global preferences load/save correctly
- Preference injection works during installation
- Auto-installation applies user preferences

### Phase 2 Complete When:
- `dexto setup` command works (interactive + non-interactive)
- Default agent uses registry system
- Auto-setup triggers on first command

### Phase 3 Complete When:
- All user flows work seamlessly
- Error messages are clear and actionable
- Non-interactive mode supports all workflows

### Final Success When:
- New users: `dexto -a database-agent` → guided setup → working agent
- Power users: Full control with preferences and non-interactive modes
- CI users: Predictable, scriptable workflows
- Migration: Existing users transition smoothly

This design creates a unified, preference-aware system while maintaining the simplicity and power of the registry approach.