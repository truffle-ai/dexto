# Preferences Module

Global user preference management for Dexto. This module handles loading, saving, and applying user preferences across the Dexto system.

## Overview

The preferences system manages global user settings stored in `~/.dexto/preferences.yml`. These preferences are applied during agent installation and provide consistent user experience across all registry agents.

### Key Concepts

- **Global scope**: Preferences apply to all registry agents installed on the user's machine
- **Install-time injection**: Preferences are applied when agents are installed, not at runtime
- **Preference precedence**: CLI overrides > Global preferences > Agent defaults
- **Security**: API keys stored as environment variable references

## Preference File Structure

### Location
- **Path**: `~/.dexto/preferences.yml`
- **Scope**: Global only (never project-specific)
- **Format**: YAML with strict validation

### Sections
- **llm**: LLM provider, model, and API key reference
- **defaults**: Default agent name for global CLI usage
- **setup**: Setup completion tracking

## Integration Points

### With Agent Registry
- Registry agents get preferences applied during installation
- Already-installed agents are NOT modified
- CLI overrides take priority over global preferences

### With CLI Commands
- **dexto setup**: Creates and manages preferences
- **dexto install**: Applies preferences during agent installation
- **dexto -a agent**: Auto-installs with preferences if agent not found

### With First-Time Setup
- Missing preferences.yml triggers first-time setup
- Setup flow creates preferences and installs default-agent
- Completion tracking prevents re-triggering

## Security Model

### API Key Handling
- API keys stored as environment variable references only
- No plaintext storage possible
- Runtime expansion handled by agent loading system
- Preferences file is safe to commit

## Design Principles

1. **Minimal**: Only essential preferences, avoid feature flags
2. **Secure**: Environment variable references only, no plaintext secrets
3. **Consistent**: YAML format matches rest of Dexto
4. **Explicit**: Clear validation with helpful error messages
5. **Non-intrusive**: Applied at install-time, not runtime
6. **Precedence-aware**: Respects CLI overrides and agent-specific settings

## Usage Context

This module supports the enhanced agent registry system (Feature Plan: agent-registry-system-2.md) by providing global preference management that eliminates hardcoded LLM configurations in agent files while maintaining user control and security.