# CLI Integration Plan (MVP)

## Goals
- Make `dexto login` provision a `DEXTO_API_KEY` and write preferences for `provider: dexto`.
- Use gateway headers to warn about low credits; add a simple `billing status` command.

## Changes
1) Setup/Login
- Update `packages/cli/src/cli/utils/login-flow.ts` to call `/api/provision` after OAuth and persist `DEXTO_API_KEY`.
- Save env var `DEXTO_API_KEY` via existing `saveProviderApiKey` helper or a new helper for `dexto`.
- Create preferences with `provider: dexto`, `baseURL: https://api.dexto.ai/v1`, `apiKey: $DEXTO_API_KEY`. Actually baseURL should be hardcoded internally and not provided in config for dexto provider to this baseURL (similar to how it is done for OpenRouter)
 - Gateway provisions per-user OpenRouter key with `include_byok_in_limit: true`; CLI does not handle OpenRouter keys directly.

2) Provider detection
- When loading preferences, if `DEXTO_API_KEY` is present, prefer `provider: dexto`.
- Fall back to `openrouter` only if `DEXTO_API_KEY` missing and `OPENROUTER_API_KEY` present.

3) Headers handling
- When printing session summaries, read `X-Dexto-Credits-Remaining` and warn when below threshold.
- On 402, print a friendly message with a top-up link.
 - Optionally, CLI can call a gateway endpoint that mirrors OpenRouter `limit_remaining` for richer UX.

4) New command: `dexto billing status`
- Calls `GET /me/usage` and prints credits and MTD usage; exits non-zero if unauthorized.

## Acceptance criteria
- `dexto login` ends with preferences using `provider: dexto`.
- Running a chat shows credits warnings when low; 402 is handled gracefully.
- `dexto billing status` prints balance and basic stats.
