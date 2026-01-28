---
'@dexto/agent-management': patch
'@dexto/server': patch
'@dexto/webui': patch
'@dexto/core': patch
'dexto': patch
---

Add Dexto authentication and gateway provider support

**Feature Flag**: `DEXTO_FEATURE_AUTH=true` (default OFF for gradual rollout)

### New CLI Commands
- `dexto login` - OAuth browser login or `--api-key` for CI/automation
- `dexto logout` - Clear stored credentials
- `dexto auth status` - Show current auth state
- `dexto billing` - View credit balance and usage

### New Provider: `dexto`
- Gateway provider routing requests through Dexto API
- Supports all OpenRouter models via `supportsAllRegistryModels` flag
- Curated model list shown during setup (mix of free and SOTA models)
- New users receive $5 credits on first login

### Model Registry Enhancements
- Added `openrouterId` field to map native model names to OpenRouter format
- Model transformation in LLM resolver for gateway providers
- New `/llm/capabilities` API for accurate capability checking across providers

### Sub-Agent Support
- LLM preferences now apply to ALL agents, not just default
- `modelLocked` feature for agents requiring specific models (e.g., explore-agent)
- Sub-agent resolution inherits parent LLM config including baseURL

### Web UI
- Settings panel for managing Dexto API keys
- Model picker updated with Dexto provider support
- "via Dexto" visual indicator when using gateway

### Security
- CSRF state validation in OAuth flow
- 10s timeouts on all Supabase auth fetch calls
- Secure credential storage in `~/.dexto/auth.json`
