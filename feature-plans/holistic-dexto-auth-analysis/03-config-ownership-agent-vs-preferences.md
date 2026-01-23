# Where Should Routing Live? (Agent Config vs Preferences)

This is the core ownership decision: routing policy must exist somewhere *reachable by core execution* and *portable to platform*.

## Existing layers in this repo

1. **Agent config** (`agents/*/*.yml`, installed agents under `~/.dexto/agents/`)
   - Portable and deployable (platform consumes agent config).
   - Contains `llm` config used by core runtime.

2. **Global preferences** (`~/.dexto/preferences.yml`)
   - Local-user defaults (CLI applies to the coding-agent at runtime today).
   - Already includes `preferDextoCredits`.

3. **Auth store**
   - Dexto login state (`DEXTO_API_KEY` loaded into process env at startup).
   - Provider keys generally come from environment variables.

## Recommendation

### Put routing policy in agent config (with defaults), and allow preferences to override locally

**Why agent config**
- Platform deployments do not have global preferences.
- “Intent” must be visible in the deployed artifact (agent config).
- Core routing is executed from `ValidatedLLMConfig`; it should not depend on CLI-only global state.

**Why also keep preferences**
- Local users want one place to set “defaults” across agents.
- Preferences are already the UX surface for setup.

### Suggested shape (conceptual)

- Add an optional field under `llm`, defaulting to “prefer Dexto”:

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  routing:
    prefer: dexto   # or: direct
```

or (minimal):

```yaml
llm:
  preferDextoCredits: true
```

Then:
- On local CLI/WebUI: `preferences.preferDextoCredits` overrides agent config.
- On platform: agent config is the source of truth (unless the platform UI provides an override).

## What should NOT live in agent config

- Secrets (Dexto API keys, provider API keys). Continue to use env vars / secret injection.
- Ephemeral auth state (OAuth refresh tokens, session cookies) — belongs in the auth store.

## Why “preferences-only” is not enough

If routing policy lives only in preferences:
- It can’t be deployed to platform as part of the agent config.
- Core services can’t reliably access it without threading preferences through many layers.
- The UI and server would need bespoke “out-of-band” resolution rules.

