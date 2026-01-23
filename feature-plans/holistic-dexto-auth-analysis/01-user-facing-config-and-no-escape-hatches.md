# User-Facing Config (Explicit Backend Providers)

## Decision: `provider: dexto` is user-facing

We’re adopting an OpenCode-like explicitness model:
- `llm.provider` is the execution backend (billing/auth endpoint).
- Switching “Dexto Credits → BYOK” is switching providers (`dexto → anthropic/openai/...`), not changing auth state.

This is intentionally deterministic and platform-friendly:
- A deployed agent config expresses exactly what backend it will call.
- No auth-dependent runtime rerouting/magic.

## Recommended config patterns

### Default (recommended): use Dexto gateway

`dexto` is OpenRouter-backed, so models are OpenRouter IDs:

```yaml
llm:
  provider: dexto
  model: anthropic/claude-sonnet-4.5
```

OpenRouter-only models are also first-class here:

```yaml
llm:
  provider: dexto
  model: z-ai/glm-4.5-air:free
```

### Direct provider (BYOK)

Direct providers use their native model namespace:

```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5
```

### Advanced: direct OpenRouter (BYOK)

Keep OpenRouter explicit and “advanced”:

```yaml
llm:
  provider: openrouter
  model: anthropic/claude-sonnet-4.5
```

## “No legacy escape hatches” stance (how it applies now)

The “escape hatch” we avoid is **implicit routing policy** that changes behavior based on auth state.
With explicit providers:
- There is no hidden “prefer Dexto” runtime switch.
- The only switching is intentional (via CLI/WebUI actions that update provider/model).
