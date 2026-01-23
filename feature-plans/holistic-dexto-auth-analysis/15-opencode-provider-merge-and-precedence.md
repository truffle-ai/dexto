# OpenCode Provider Merge + Precedence (What “merging logic” means)

This documents what OpenCode actually does when it “merges” registry + config + auth state.

Primary implementation:
- `/Users/karaj/Projects/external/opencode/packages/opencode/src/provider/provider.ts`

## 1) Base registry: models.dev

They start from the models.dev provider/model catalog:
- `/Users/karaj/Projects/external/opencode/packages/opencode/src/provider/models.ts`
- `ModelsDev.get()` returns `Record<providerId, Provider>`

They map models.dev providers/models into internal `Provider.Info` types.

## 2) Config overlay extends the registry

OpenCode lets `opencode.json` override/extend providers/models:
- `config.provider[providerId]` can add:
  - provider name/env/options
  - model definitions under `provider.models`

In provider init, they apply this overlay (“extend database from config”):
- Add or override providers
- Add or override models within providers
- Merge options/capabilities via `mergeDeep`

This is their “custom models” feature.

## 3) Credential layering: env → auth store → plugins → config

After building the provider/model list, they attach credentials and runtime options:

1. Environment variables
   - If any env var listed in `provider.env` is set, they mark the provider as configured.
2. Auth store (`auth.json`)
   - Stored API keys are applied and take precedence over env in practice.
3. Plugin-provided auth (OAuth flows)
   - If a provider has plugin auth and the user completed OAuth, plugin loader supplies options.
4. Custom “loaders” (built-in special cases)
   - Example: `CUSTOM_LOADERS.opencode` filters paid models unless user has a key.

Finally, they apply config provider settings again to ensure config overrides are respected.

## 4) Filtering: enabled/disabled + whitelist/blacklist + experimental

They remove providers/models based on:
- `enabled_providers` / `disabled_providers` config
- per-provider `whitelist` / `blacklist` model IDs
- experimental flags and model status

## Practical takeaway for Dexto

OpenCode’s “merge logic” is a concrete, repeatable pattern:
- **Registry → overlay → credential sources → filter**

For Dexto, the analogous problem is:
- “catalog → custom models → effective credentials (Dexto vs direct) → what the UI should allow”

