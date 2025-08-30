# LLM Model Selection UI (T3.chat–style) + API Key Integration

Status: Draft
Owner: Web UI / Core Platform
Target: Next Web UI release

## Summary

Add a modern model selection experience to the Dexto web UI, inspired by T3.chat’s selector. The picker will:

- Present models grouped by provider with search, favorites, and capability badges.
- Integrate with API key detection: if a provider’s key is missing, prompt the user in‑app and persist it (no CLI required).
- Reuse core logic for environment key storage so CLI and Web share a single implementation.
- Respect router and baseURL constraints from our registry and schemas.

This plan covers UI/UX, backend endpoints, shared core helpers, security, testing, rollout, and migration notes. APIs will not expose or depend on TypeScript types; use runtime validation (Zod) and document responses with JSON examples only.

---

## Goals

- Fast, discoverable model switching with minimal friction.
- Zero-copy secret handling: never echo keys back to client, redact logs.
- Shared core implementation for saving provider API keys; avoid duplication between CLI and Web.
- Replaces existing `LLMSelector` in the Web UI.

## Non-Goals

- Payment/upgrade banner logic (placeholder only if needed).
- Server-side license entitlement checks.
- Adding/curating new models in the registry beyond small UI metadata (optional tags/displayName only).

---

## UX Overview

Entry points:
- Button in the top bar (replaces or complements current `LLMSelector`).
- Keyboard shortcut (e.g., `Cmd/Ctrl+K` then “Models”).

Layout (modal/drawer):
- Search bar with debounce.
- Banner slot (optional) for upgrade/promotions.
- Sections:
  - Favorites (pinned models) – stored locally for now.
  - All providers – grid/list of model cards grouped by provider.
- Model card contents:
  - Provider brand/icon, model display name, optional subtitle.
  - Capability badges: vision/image/audio/pdf/reasoning/experimental/new.
  - Disabled/locked state when provider key is missing (tooltip explains).

Interaction:
- Click a model:
  - If provider key exists → POST `/api/llm/switch` → success toast → close.
  - If provider key missing → open ApiKeyModal → on submit, POST `/api/llm/key` → then POST `/api/llm/switch`.
- Advanced panel:
  - Router select (when multiple supported).
  - Base URL input for OpenAI‑compatible or any provider where `supportsBaseURL` is true.

Accessibility:
- Keyboard navigable grid, ARIA labels on buttons, tooltips not required to get critical info, focus management within modal.

Responsive behavior:
- Drawer on mobile, modal dialog on desktop; grid collapses to 1–2 columns.

---

## Data Model & Sources

- Registry: `src/core/llm/registry.ts` is the single source of truth for providers/models.
  - Implemented: `displayName` for all current models (UI prefers this; raw slug is fallback).
- Key status: derived from `resolveApiKeyForProvider(provider)` in core.
- Router support: via `getSupportedRoutersForProvider` / `isRouterSupportedForModel`.
- File support badges: `supportedFileTypes` at model level.

Optional registry enhancements (non-breaking):
- `ModelInfo` optional fields:
  - `tags?: Array<'vision'|'image'|'audio'|'pdf'|'reasoning'|'realtime'|'tool_use'|'experimental'|'new'>`

---

## Backend

New endpoints (Express in `src/app/api/server.ts`):

1) GET `/api/llm/catalog`
- Returns providers, models, and key presence.
- Example response (JSON):
  ```json
  {
    "providers": {
      "openai": {
        "name": "Openai",
        "hasApiKey": false,
        "primaryEnvVar": "OPENAI_API_KEY",
        "supportedRouters": ["vercel", "in-built"],
        "supportsBaseURL": false,
        "models": [
          { "name": "gpt-4o", "default": false, "maxInputTokens": 128000, "supportedFileTypes": ["pdf"] }
        ]
      }
    }
  }
  ```

2) POST `/api/llm/key`
- Saves a provider API key securely and makes it available immediately.
- Request body (JSON): `{ "provider": "openai", "apiKey": "..." }` (never logged or echoed back)
- Response (JSON): `{ "ok": true, "provider": "openai", "envVar": "OPENAI_API_KEY" }`
- Behavior:
  - Uses shared core helper (see below) to update the correct `.env` and mutate `process.env`.
  - Validates non-empty key, redacts logs.

Notes:
- `/api/llm/current` includes `displayName` for known models.
- Ensure redaction middleware applies to `/api/llm/*` routes (already present).

---

## Shared Core Helper (New)

Add `src/core/utils/api-key-store.ts`:

```ts
import { LLMProvider } from '../llm/registry.js';

export async function saveProviderApiKey(
  provider: LLMProvider,
  apiKey: string,
  opts?: { scope?: 'project'|'global'; startPath?: string }
): Promise<{ envVar: string; targetEnvPath: string }>; // never return the key

export function getProviderKeyStatus(provider: LLMProvider): { hasApiKey: boolean; envVar: string };

export function listProviderKeyStatus(): Record<string, { hasApiKey: boolean; envVar: string }>;
```

Implementation details:
- Resolve env var name via `getPrimaryApiKeyEnvVar(provider)`.
- Resolve target file path via `getDextoEnvPath(startPath)` if `scope` not specified; otherwise force `project` or `global`.
- Persist via `updateEnvFile(targetEnvPath, { [envVar]: apiKey })`.
- Immediately set `process.env[envVar] = apiKey` to avoid restart.
- Never log or return the key; return metadata only.

CLI migration:
- Update `src/app/cli/utils/env-utils.ts:updateEnvFileWithLLMKeys` to call `saveProviderApiKey` (keep function and tests intact).

---

## Frontend

New components in `src/app/webui/components`:

- `ModelPickerModal`
  - Loads `/api/llm/catalog` on open; reads current model from `ChatContext` to avoid flicker.
  - Search input, Favorites section, Provider groups, Model cards.
  - Capability badges from `supportedFileTypes` and optional tags.
  - Click handler: if `hasApiKey` then POST `/api/llm/switch`; else open `ApiKeyModal`.
  - Advanced panel: router select (enforced by `isRouterSupportedForModel`), baseURL when `supportsBaseURL`.

- `ApiKeyModal.tsx`
  - Shows provider display name and `primaryEnvVar` hint.
  - Input: password field for API key.
  - Optional: scope select (Project / Global) – default based on context.
  - On submit: POST `/api/llm/key`; then reattempt switch.

Integration points:
- Entry button placed in chat footer; replaces previous `ModelSelector` UX (old component to be removed).

Local storage:
- `dexto:modelFavorites` – string[] of `provider|model` pairs.

 

---

## Security & Privacy

- Do not send API keys back to the client; only return `{ ok, provider, envVar }`.
- Redact request bodies and logs under `/api/llm/*` (middleware already in place).
- Mutate `process.env` on the server after save to enable immediate usage without restart.
- Validate/sanitize inputs; limit body size for `/api/llm/key`.

---

## Edge Cases & Behavior

- Router mismatch: If the current router isn’t supported by the selected model, auto-select the first supported router; show a small notice.
- `openai-compatible` / custom baseURL:
  - Show baseURL field with validation (http/https, includes `/v1`).
  - Require baseURL when provider `requiresBaseURL(provider)`.
- Unknown model names (if registry updated later): fallback to provider default or disable card.
- File support badges: reflect `supportedFileTypes` exactly; present warnings if a user attempts to attach unsupported files.

---

## API/Type Contracts (Reference)
No TypeScript type exports. Runtime validation only.

- POST `/api/llm/switch` (existing) body (JSON): `{ "provider": "...", "model": "...", "router": "...", "apiKey": "?", "baseURL": "?", "sessionId": "?" }`
- GET `/api/llm/current` (existing): `{ "config": { provider, model, displayName?, router?, baseURL?, ... } }`
- GET `/api/llm/providers` (existing): superseded by `/api/llm/catalog` for the new UI

---

## Implementation Steps

1) Core helper
- [x] Add `src/core/utils/api-key-store.ts` with functions above and unit tests.
- [x] Remove duplicate CLI helper `env-utils` and update CLI to use the core helper.
- [x] Add unit tests (`api-key-store.test.ts`) that mock `getDextoEnvPath`, write to a temp `.env`, and assert `process.env` is updated. Do not call `applyLayeredEnvironmentLoading` inside the helper; keep it at app startup only.

2) Backend endpoints
- [x] Add `GET /api/llm/catalog` (compose from `LLM_REGISTRY`, router utilities, and key status).
- [x] Add `POST /api/llm/key` (use `saveProviderApiKey`).
- [x] Ensure redaction middleware covers new routes; add validation with Zod.
- [ ] Add minimal integration tests for both. (Script coverage exists; promote to Vitest + Supertest.)

3) Frontend UI
- [x] Build `ModelPickerModal` (search, grouped view, favorites).
- [x] Build `ApiKeyModal` (POST `/api/llm/key`, immediate retry).
- [x] Wire to `/api/llm/catalog`, `/api/llm/key`, `/api/llm/switch`.
- [ ] Remove legacy `ChatInput/ModelSelector` (no callers left) and its export.
- [ ] Provider branding icons (SVGs in `public/` or icon set fallback).

4) QA & Rollout
- [x] Manual flows: no-key → prompt → save → switch; existing key → switch; router mismatch auto-select.
- [ ] Manual flow: openai-compatible/custom baseURL (validation + switch).
- [ ] Accessibility pass; mobile layout.
- [ ] Remove legacy selector code.

---

## Testing Plan

Core
- Unit tests for `saveProviderApiKey` (scope resolution, env var name, process.env mutation, no secret leakage).

API
- Integration tests for `/api/llm/catalog` (shape, key status) and `/api/llm/key` (success, validation errors, redaction).

UI (manual)
- Search & filtering behave correctly.
- Favorites persist and render.
- Disabled state when key missing; tooltip visible.
- ApiKeyModal saves key and immediately allows switching.
- Router/baseURL advanced options behave per provider.

---

## Risks & Mitigations

- Secret leakage in logs → use existing `/api/llm/*` redaction middleware; double-check no manual logs include raw bodies.
- Stale env values → set `process.env` after save; return clear success to UI.
- Registry drift → UI guards against unsupported router/fileTypes; fallbacks where safe.


---

## Open Questions

- Default key persistence scope in web UI (project vs global). Proposal: infer via `getExecutionContext`; allow override in ApiKeyModal.
- Do we want to store Favorites in global preferences instead of localStorage later?
- Should we add server-generated tags (e.g., `experimental`, `new`) to registry for consistent UI?

---

## Acceptance Criteria

- Users can pick a model from a searchable, grouped UI.
- If an API key is missing, users are prompted, can save, and immediately switch models without CLI.
- Keys are stored securely in the right `.env`, not exposed to the client, and available at runtime.
- Router/baseURL constraints are enforced and explained.
- New selector is the default; old selector removed.
