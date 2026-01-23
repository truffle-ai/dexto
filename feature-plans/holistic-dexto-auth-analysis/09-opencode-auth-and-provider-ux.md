# OpenCode Auth + Provider UX (What’s Worth Copying)

This is relevant because OpenCode’s UX matches the “explicit backend provider” direction.

## Auth storage is decoupled from model selection

OpenCode stores credentials in a single auth store:
- `/Users/karaj/Projects/external/opencode/packages/opencode/src/auth/index.ts`
  - Discriminated union: `oauth | api | wellknown`
  - Stored as `auth.json` with 0600 permissions

Model selection is just `provider/model` in config; auth is a separate concern.

## Provider connect UX supports multiple auth methods

The “Connect a provider” dialog shows auth method choices per provider:
- `/Users/karaj/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx`
  - Methods list comes from `sync.data.provider_auth[providerId]`
  - Supports both:
    - OAuth flows (browser + callback)
    - API key entry

This is exactly the UX pattern you’d want for Dexto long term:
- “Dexto Credits” (login) is just another auth method.
- “BYOK” is another auth method.
- Users switch methods without rewriting their model choices.

Where the auth-method list comes from:
- The TUI “sync” store fetches `provider_auth` from the server:
  - `/Users/karaj/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/context/sync.tsx`

## They also make business/UX choices explicit

OpenCode does not try to “hide OpenRouter”; it’s an explicit provider and they even show a warning:
- `/Users/karaj/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/app.tsx`

They push their curated paid gateway (“Zen”) instead:
- Provider connect dialog copy: `/Users/karaj/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx`

## Their paid gateway (“opencode”) is handled by auth-aware filtering

Key pattern:
- If user has no key for opencode gateway, paid models are removed from list so users can’t select them by mistake.
- Implementation: `/Users/karaj/Projects/external/opencode/packages/opencode/src/provider/provider.ts` (`CUSTOM_LOADERS.opencode`)

This is relevant to Dexto as “don’t show things that will fail” rather than “let users pick and error”.

## How their “provider” concept maps to Dexto (explicit providers)

OpenCode’s “providers” are explicit execution backends / billing endpoints:
- `anthropic` provider → Anthropic auth + Anthropic model IDs
- `openrouter` provider → OpenRouter auth + OpenRouter model IDs
- `opencode` provider → OpenCode Zen auth + curated model IDs (gateway product)

This is why OpenCode avoids runtime model-ID mapping across backends: the backend is part of the model identity.

For Dexto, we’re taking the same approach:
- `dexto` is a first-class provider (gateway product)
- `openrouter` stays a first-class provider (advanced BYOK)
- direct providers stay first-class (BYOK / OAuth)

## Takeaways for Dexto

1. **Auth methods are a first-class concept**: per-provider method selection is a clean mental model.
2. **Model selection stays stable**: switching auth should not require rewriting `provider/model`.
3. **Prefer prevention over errors**: filter/annotate models in picker based on effective auth availability.
