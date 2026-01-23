# Auto-Update and Migration Guidance (Auth/Routing)

This section is focused on keeping the auto-update + schema migration story clean while we iterate on auth/routing.

Reference: `~/Projects/dexto-cli-fixes-2/feature-plans/auto-update.md`

## Big constraint: users modify YAML

Users may modify:
- Global preferences (`~/.dexto/preferences.yml`)
- Installed agent configs (`~/.dexto/agents/*/*.yml`)

Therefore, any change that requires rewriting those files must be treated as high-risk and needs:
- backups
- atomic writes
- deterministic migrations
- clear rollback path

## Recommendation: prefer additive defaults over migrations

For auth/routing features, prefer:
- Adding optional fields with `.default()` in Zod schemas
- Implementing behavior changes in runtime resolution

This avoids per-field merge logic and avoids clobbering user customizations.

Per the auto-update plan:
- New optional fields with defaults should **not** require migrations.

## Handling modified bundled agents (recommended approach)

Use whole-file replacement only when the bundled agent is unmodified:
- Track a `bundledHash` in `~/.dexto/agents/registry.json`.
- If user modified the file, do not overwrite; rely on defaults at runtime.

Auth/routing additions should be designed so that:
- A user-modified agent config still runs without needing file edits.
- New behavior can still activate via preferences + auth state.

## Pre-release “breaking” changes

Because this feature is unreleased:
- It is reasonable to remove unsupported config shapes (e.g. `provider: dexto`) without migration.

Post-release, that becomes a real migration problem. If we ever ship `provider: dexto` publicly, we own that shape forever.

## Suggestion for future schema evolution

If we add routing policy to agent config:
- Make it optional with a default (prefer Dexto).
- Keep it stable and avoid renames.
- Avoid nesting under multiple layers unless we’re committed to it (nesting increases migration friction).

If we add more auth modes (OAuth, BYOK, enterprise):
- Keep secrets out of YAML; put them into the auth store / platform secret injection.
- Keep YAML as “desired behavior”, not “token storage”.

