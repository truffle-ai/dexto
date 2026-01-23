# Auto-Update and Migration Guidance (Explicit Provider)

This section is focused on keeping the auto-update + schema migration story clean while we iterate on auth/model selection.

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

For auth/model-selection features, prefer:
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
- It is reasonable to change the default bundled agent from a direct provider to `provider: dexto`.
- It is reasonable to remove the transparent-routing behavior (auth-dependent rerouting) without a complex migration.

## Suggestion for future schema evolution

If we add more auth modes (OAuth, BYOK, enterprise):
- Keep secrets out of YAML; put them into the auth store / platform secret injection.
- Keep YAML as “desired behavior”, not “token storage”.
 
If we want better UX defaults without rewriting YAML:
- Add defaults in preferences (e.g., “default backend for new agents is dexto”)
- Only rewrite agent YAML when the agent is unmodified (bundledHash strategy)
