# Execution Context Behavior Analysis

## Overview

Dexto operates in three distinct execution contexts, each with different behavioral expectations for config resolution, preference handling, and first-time setup. This document defines the expected behavior for each context to ensure consistent and predictable user experience.

## Context Detection

### Context Detection Logic
```typescript
const projectRoot = getDextoProjectRoot(); // Finds package.json with dexto dependency
const isSource = isDextoSourceCode();       // Checks if package.json name === 'dexto'

if (isSource) {
    // Context 3: Dexto Source Code
} else if (projectRoot) {
    // Context 2: Dexto Project  
} else {
    // Context 1: Global CLI
}
```

## Context 1: Global CLI (Outside Any Project)

### Detection
- `getDextoProjectRoot()` returns `null`
- Running from user's home directory, desktop, or any non-dexto directory

### Expected Behavior

#### Default Command (`dexto "message"`)
- **Config Resolution**: Uses registry `default-agent` with preference injection
- **Installation**: Auto-install to `~/.dexto/agents/default-agent.yml` with global preferences applied
- **First-time Setup**: Triggered by `~/.dexto/preferences.yml` absence
- **Storage**: Uses `~/.dexto/database/`, `~/.dexto/logs/`

#### Registry Commands (`dexto -a database-agent`)
- **Config Resolution**: Uses registry agent with preference injection  
- **Installation**: Auto-install to `~/.dexto/agents/{agent}/` or `~/.dexto/agents/{agent}.yml` with global preferences
- **Preferences**: Global preferences applied during installation
- **Storage**: Uses `~/.dexto/database/`, `~/.dexto/logs/`

#### File Commands (`dexto -a ./custom.yml`)
- **Config Resolution**: Direct file resolution (no preferences applied)
- **No Installation**: Direct file loading
- **No Preferences**: File used as-is (user controls LLM config)
- **Storage**: Uses `~/.dexto/database/`, `~/.dexto/logs/`

### Preference Handling
- **Global preferences**: Read from `~/.dexto/preferences.yml`
- **Preference injection**: Applied to registry agents at install-time
- **API keys**: Read from `~/.dexto/.env`
- **First-time setup**: Creates preferences, installs default-agent with preferences

### Critical Requirements
- NEVER modify existing installed agents (only inject during first install)
- ALWAYS use global storage locations
- ALWAYS apply preferences to registry agents (not file-based agents)

## Context 2: Dexto Project (Inside `dexto create-app` Projects)

### Detection
- `getDextoProjectRoot()` returns project directory
- `isDextoSourceCode()` returns `false`
- Package has dexto as dependency (not name === 'dexto')

### Expected Behavior

#### Default Command (`dexto "message"`)
- **Config Resolution**: Project config search (no registry, no preferences)
  1. `{project}/agents/default-agent.yml`
  2. `{project}/src/agents/default-agent.yml` 
  3. `{project}/src/dexto/agents/default-agent.yml`
  4. `{project}/.dexto/default-agent.yml`
  5. `{project}/default-agent.yml`
- **No Installation**: Uses project files directly
- **No Preferences**: Project configs used as-is (preserve development workflow)
- **Storage**: Uses `{project}/.dexto/database/`, `{project}/.dexto/logs/`

#### Registry Commands (`dexto -a database-agent`)
- **Config Resolution**: Uses registry agent with global preferences (!)
- **Installation**: Auto-install to `~/.dexto/agents/{agent}/` or `~/.dexto/agents/{agent}.yml` (not project-local)
- **Preferences**: Global preferences applied (consistent experience)
- **Storage**: Uses `{project}/.dexto/database/`, `{project}/.dexto/logs/`

#### File Commands (`dexto -a ./custom.yml`)
- **Config Resolution**: Project-relative file resolution
- **No Installation**: Direct file loading
- **No Preferences**: File used as-is
- **Storage**: Uses `{project}/.dexto/database/`, `{project}/.dexto/logs/`

### Preference Handling
- **No preference injection**: Project configs remain isolated from global preferences
- **Registry agents exception**: Registry agents still get global preferences (user expects consistency)
- **Project API keys**: Read from `{project}/.env`
- **No first-time setup**: Projects are pre-configured

### Critical Requirements
- NEVER apply global preferences to project configs
- ALWAYS use project-local storage
- ALWAYS preserve existing project config behavior
- Registry agents still get global preferences for consistency

## Context 3: Dexto Source Code (Inside Dexto Repo)

### Detection
- `getDextoProjectRoot()` returns dexto repo directory
- `isDextoSourceCode()` returns `true`
- Package name === 'dexto'

### Expected Behavior

#### Default Command (`dexto "message"`)
- **Config Resolution**: Project config search (development config)
  1. `{dexto-repo}/agents/default-agent.yml` (current approach)
  2. Fallback paths same as Context 2
- **No Installation**: Uses development files directly
- **No Preferences**: Uses development config as-is
- **No First-time Setup**: Never trigger setup in source code
- **Storage**: Uses `{dexto-repo}/.dexto/database/`, `{dexto-repo}/.dexto/logs/`

#### Registry Commands (`dexto -a database-agent`)
- **Config Resolution**: Registry agent (for testing registry system)
- **Installation**: Auto-install to `~/.dexto/agents/{agent}/` or `~/.dexto/agents/{agent}.yml` (test global behavior)
- **Preferences**: Global preferences applied (test preference injection)
- **Storage**: Uses `{dexto-repo}/.dexto/database/`, `{dexto-repo}/.dexto/logs/`

#### File Commands (`dexto -a ./agents/database-agent.yml`)
- **Config Resolution**: Direct file resolution (for development testing)
- **No Installation**: Direct file loading
- **No Preferences**: File used as-is
- **Storage**: Uses `{dexto-repo}/.dexto/database/`, `{dexto-repo}/.dexto/logs/`

### Preference Handling
- **No preference injection**: Development configs remain isolated
- **Global preferences available**: For testing registry agents
- **Development API keys**: Read from `{dexto-repo}/.env`
- **Never first-time setup**: `isDextoSourceCode()` prevents setup triggers

### Critical Requirements
- NEVER trigger first-time setup in source code
- ALWAYS use project-local storage for development
- ALLOW registry agent testing with global preferences
- PRESERVE development workflow flexibility

## First-Time Setup Matrix

| Context | Trigger | Behavior |
|---------|---------|----------|
| Global CLI | `~/.dexto/preferences.yml` missing | Interactive setup → creates preferences.yml |
| Dexto Project | N/A | Never triggered (projects are pre-configured) |
| Dexto Source | N/A | Never triggered (`isDextoSourceCode()` check) |

## Storage Location Matrix

| Context | Database | Logs | Preferences | Registry Agents |
|---------|----------|------|-------------|-----------------|
| Global CLI | `~/.dexto/database/` | `~/.dexto/logs/` | `~/.dexto/preferences.yml` | `~/.dexto/agents/` |
| Dexto Project | `{project}/.dexto/database/` | `{project}/.dexto/logs/` | `~/.dexto/preferences.yml` | `~/.dexto/agents/` |
| Dexto Source | `{repo}/.dexto/database/` | `{repo}/.dexto/logs/` | `~/.dexto/preferences.yml` | `~/.dexto/agents/` |

## Config Resolution Decision Tree

```
dexto [options] "message"
├── opts.agent provided?
│   ├── YES: isPath(opts.agent)?
│   │   ├── YES (file path): path.resolve(opts.agent) → loadAgentConfig()
│   │   └── NO (registry name): registry.resolveAgent() → loadAgentConfig()
│   └── NO (default): Context check
│       ├── Context 3 (Source): Project search → agents/default-agent.yml
│       ├── Context 2 (Project): Project search → agents/default-agent.yml  
│       └── Context 1 (Global): registry.resolveAgent('default-agent')
```

## Preference Injection Rules

### When Preferences Are Applied
- **Registry agents only**: Never applied to file-based agents
- **Install-time only**: Never applied to already-installed agents  
- **All contexts**: Even project/source contexts use global preferences for registry agents

### What Gets Injected
- **Core fields only**: `llm.provider`, `llm.model`, `llm.apiKey`
- **Preserve agent settings**: `llm.temperature`, `llm.router`, `llm.maxTokens`, etc.
- **Registry constraints**: Honor `supportedProviders`, `lockProvider` from registry.json

### Injection Precedence
```
CLI overrides > Global preferences > Agent defaults
```

## Testing Requirements

### Context Isolation Testing
- Verify each context uses correct storage locations
- Verify preference injection only happens in appropriate cases
- Verify first-time setup triggers only in Global CLI context

### Transition Testing  
- Test switching between contexts (cd in/out of projects)
- Test registry agents work consistently across all contexts
- Test file agents remain unaffected by preferences

### Edge Case Testing
- Test when preferences.yml exists but is corrupted
- Test when project has no default config (should fail, not fall back to global)
- Test when dexto source repo has no bundled config