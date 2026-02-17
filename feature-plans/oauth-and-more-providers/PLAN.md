# OAuth + Multi-Method Provider Connect

This plan updates Dexto onboarding/login flows to support **multiple login methods per provider** (OAuth/subscription, BYOK API keys, device-code flows, “setup-token”-style flows) and expands the set of “first-class” providers where it’s worthwhile.

**Working memory:** [`WORKING_MEMORY.md`](./WORKING_MEMORY.md) is a colocated scratchpad that agents should actively update while working through this plan. **Read it before starting work. Update it after each task.**

**Owner verification list:** [`USER_VERIFICATION.md`](./USER_VERIFICATION.md) tracks **owner-only** decisions and manual checks we deliberately defer while implementing. **Add an entry whenever you discover an unresolved decision or an environment-dependent verification.** Clear the list before shipping.

Primary references:
- **OpenClaw** (`~/Projects/external/openclaw`) — onboarding wizard + auth profiles + provider auth plugins.
- **OpenCode** (`~/Projects/external/opencode`) — `/connect` UX + models.dev-backed provider catalog + plugin auth methods.

---

## 1. Problem

Today Dexto largely treats provider auth as “do you have an API key env var?”, with an exception for `dexto-nova` (Dexto login → `DEXTO_API_KEY`).

Ground truth in the repo today:
- **Provider API keys** are resolved from env vars (`packages/core/src/utils/api-key-resolver.ts`) and can be written via server routes (`packages/server/src/hono/routes/key.ts` → `@dexto/agent-management` writes to a context-aware `.env`).
- **Dexto account login** state lives in `~/.dexto/auth.json` (see `packages/cli/src/cli/auth/service.ts` and `packages/agent-management/src/utils/dexto-auth.ts`). The CLI loads `DEXTO_API_KEY` from this file early (`packages/cli/src/index-main.ts`) for `dexto-nova` routing.

We want:
- **Per-provider auth method selection** (e.g. OpenAI: ChatGPT OAuth *or* API key).
- A clear **/connect** experience from the interactive CLI (and a corresponding WebUI flow).
- A single internal shape for “a provider supports these login methods”, so UX and behavior match what’s truly supported.

---

## 2. Goals

- Add a **`/connect`** interactive CLI command to connect a provider via one of its supported methods.
- Support **multiple login methods per provider** (when available), at minimum:
  - **OpenAI**: API key + ChatGPT OAuth (Codex-style).
  - **Anthropic**: API key + subscription token (“setup-token” flow, if viable).
  - **Bedrock**: AWS bearer token + AWS credential chain guidance.
- Make provider auth **runtime-affecting**:
  - OAuth tokens should be refreshable without forcing the user to re-login.
  - The LLM factory should be able to apply provider-specific runtime options (headers/fetch/baseURL) depending on the active auth method.
- Keep **models.dev as the model registry source of truth** (we already do).

---

## 3. Non-Goals (for this initial iteration)

- Dynamically installing arbitrary provider SDK packages at runtime (OpenCode can because it’s Bun-first and leans on dynamic installs).
- Perfect parity with OpenCode’s “75+ direct providers” UX in v1.
- OpenClaw-style **profile rotation/failover** (cooldowns, usage-based ordering) in v1 — we’ll start with saved profiles + a single default profile per provider.

---

## 4. Prior Art — OpenClaw (Concrete Observations)

### 4.1 Method grouping in onboarding
- The onboarding wizard prompts a **provider group** first, then an **auth method** if the group has >1 option.
  - Source: `~/Projects/external/openclaw/src/commands/auth-choice-options.ts`
  - UX: `promptAuthChoiceGrouped()` in `~/Projects/external/openclaw/src/commands/auth-choice-prompt.ts`

### 4.2 Auth profiles (multiple credentials per provider)
- Credentials are stored as **profiles** (e.g. `anthropic:default`, `openai-codex:default`) and config references a profile ID.
- Profiles support multiple credential modes (`api_key`, `token`, `oauth`) and include usage stats + cooldowns.
  - Entry: `~/Projects/external/openclaw/src/agents/auth-profiles/*`
  - Key resolver (including OAuth refresh): `~/Projects/external/openclaw/src/agents/auth-profiles/oauth.ts`

### 4.3 OAuth flows with “VPS-aware” UX
- Shared helper supports:
  - local browser open + localhost callback, OR
  - remote/VPS mode that prints a URL and asks user to paste redirect/code.
  - Source: `~/Projects/external/openclaw/src/commands/oauth-flow.ts`

### 4.4 Provider auth plugins return “config patch + credentials”
- Provider plugins return:
  - profiles to store,
  - `configPatch` (models/providers + defaults),
  - `defaultModel` suggestion,
  - notes.
  - Source types: `~/Projects/external/openclaw/src/plugins/types.ts` (`ProviderPlugin`, `ProviderAuthMethod`, `ProviderAuthResult`)
  - Example OAuth provider plugin: `~/Projects/external/openclaw/extensions/minimax-portal-auth/index.ts`

### 4.5 Model catalog is *not* models.dev
- OpenClaw uses `@mariozechner/pi-ai` model registry + `models.json` generation, and only bridges certain OAuth creds into `auth.json` for discovery.
  - Source: `~/Projects/external/openclaw/src/agents/model-catalog.ts`

Key takeaways to borrow:
- **Group provider → pick method** UX.
- **Credential profiles** and a resolver that can **refresh OAuth**.
- A shared OAuth UX helper that supports **headless/remote** flows.

---

## 5. Prior Art — OpenCode (Concrete Observations)

### 5.1 `/connect` UX (TUI) and a matching CLI flow
- TUI `/connect` launches a dialog:
  1) choose provider
  2) choose method (if provider has plugin-auth methods; otherwise default to API key)
  3) complete OAuth (device-code auto polling or code entry) or paste API key
  - UI: `~/Projects/external/opencode/packages/app/src/components/dialog-select-provider.tsx`
  - UI: `~/Projects/external/opencode/packages/app/src/components/dialog-connect-provider.tsx`
- CLI equivalent: `opencode auth login`
  - Source: `~/Projects/external/opencode/packages/opencode/src/cli/cmd/auth.ts`

### 5.2 Provider/model catalog from models.dev
- Providers/models are fetched + cached from models.dev:
  - Source: `~/Projects/external/opencode/packages/opencode/src/provider/models.ts`
- Provider registry merges:
  - models.dev → config overrides → env vars → stored keys → plugin OAuth → custom loaders
  - Source: `~/Projects/external/opencode/packages/opencode/src/provider/provider.ts`

### 5.3 Plugin auth methods for “OAuth vs API key” per provider
- Auth methods are per provider and can include multiple methods.
- OpenAI plugin supports both ChatGPT OAuth (browser callback + device-code) and API key.
  - Source: `~/Projects/external/opencode/packages/opencode/src/plugin/codex.ts`
- GitHub Copilot uses device-code and supports enterprise variant selection.
  - Source: `~/Projects/external/opencode/packages/opencode/src/plugin/copilot.ts`

### 5.4 OAuth is *runtime-affecting*, not just “store a token”
- For ChatGPT OAuth, the plugin:
  - injects `Authorization: Bearer <access token>`
  - rewrites requests to `https://chatgpt.com/backend-api/codex/responses`
  - refreshes the access token when expired
  - Source: `~/Projects/external/opencode/packages/opencode/src/plugin/codex.ts`

Key takeaways to borrow:
- A first-class **/connect** UX.
- A method list per provider, where OAuth methods are **two-phase** (authorize → callback).
- OAuth methods that can return **runtime request overrides** (headers/fetch/url rewriting).
- Strong alignment between **provider catalog** and **what can actually be connected**.

---

## 6. Proposed Dexto Design

### 6.1 Unify “provider auth methods” (types + registry)

Add a module (location TBD; see `USER_VERIFICATION.md`) that defines:
- `ProviderAuthMethod` definitions and a registry keyed by provider (method metadata for CLI/WebUI/server).
- `ProviderAuthMethodKind`: `api_key | oauth_pkce | oauth_device_code | token | aws_chain | custom`.
- `ProviderAuthResult` for **persisted outputs** (credentials + metadata).
- `ProviderRuntimeAuth` for **runtime outputs** used by the LLM factory:
  - `apiKey?: string`
  - `headers?: Record<string,string>`
  - `fetch?: typeof fetch`
  - `baseURL?: string`
  - `notes?: string[]`

Important: for OpenAI “ChatGPT OAuth/Codex”, runtime behavior is different (bearer token + URL rewrite). This must be modeled as runtime overrides, not just “we got a key”.

### 6.2 Credential storage: provider credentials + active method

We need to support:
- multiple saved credential profiles per provider
- a per-provider default profile (so most users never touch agent config)
- OAuth refresh metadata (expires, refresh token, account/org ids)

Proposed on-disk layout (subject to owner verification in `USER_VERIFICATION.md`):
- `~/.dexto/auth/` (new, `0o700`)
  - `dexto.json` — Dexto account login state (migrate from legacy `~/.dexto/auth.json`).
  - `llm-profiles.json` — LLM provider credential profiles + defaults.

Backwards compatibility:
- Continue to read `~/.dexto/auth.json` (legacy) and migrate-on-write to `~/.dexto/auth/dexto.json`.

`llm-profiles.json` should support:
- Multiple saved profiles per provider, keyed by `profileId` like `${providerId}:${name}` (examples: `openai:work`, `openai:codex-oauth`, `openrouter:team`).
- A per-provider default pointer so most users never touch agent config:
  - `defaults[providerId] = profileId`
- Profile credential modes (`api_key`, `oauth`, `token`, …) with refresh metadata for OAuth (`expiresAt`, `refreshToken`, optional account/org ids).

Resolution precedence (v1, proposed):
1) explicit `llm.apiKey` in agent config
2) optional explicit `llm.authProfileId` (if we ship it in v1)
3) default profile for `llm.provider` from `llm-profiles.json`
4) env var fallback (existing behavior)

### 6.3 Server API (for WebUI + future remote clients)

Add Hono routes in `packages/server/src/hono/routes/` analogous to the existing `/llm/key` surface:
- `GET /llm/auth/methods` → per-provider supported methods (labels + kinds + requirements).
- `GET /llm/auth/profiles` → list saved profiles (masked previews only) + per-provider defaults.
- `POST /llm/auth/profiles` → upsert a profile (API-key, token) or store an OAuth result.
- `POST /llm/auth/defaults` → set `defaults[providerId] = profileId`.
- `POST /llm/auth/api-key` → store BYOK (existing `/llm/key` can remain; we can alias/migrate).
- `POST /llm/auth/oauth/authorize` → returns `{ url, mode: auto|code, instructions, stateId }`.
- `POST /llm/auth/oauth/callback` → completes OAuth (with optional `code`) and persists credential.
- `GET /llm/auth/status` → per-provider connection status + which method is active (no secrets, masked previews only).

Implementation note:
- Even for CLI-only first pass, designing the API as a **two-phase authorize/callback** flow reduces later churn.

### 6.4 CLI UX

#### 6.4.1 New interactive command: `/connect`
- Location: `packages/cli/src/cli/commands/interactive-commands/`
- Flow:
  1) pick provider (curated list first + search; align with `LLM_REGISTRY` curated scope)
  2) choose action:
     - connect **new** profile, or
     - switch **default** profile (if profiles exist), or
     - manage profiles (remove/rename) (optional v1)
  3) for “connect new profile”: show supported methods for that provider
  4) run method flow:
     - API key: paste, optional verify, store
     - OAuth: open URL, auto-poll (device code) or ask for code/redirect URL (PKCE or remote mode)
     - Token/setup-token: show instructions, paste token, store
  5) prompt: “Set as default for `${providerId}`?” (writes `defaults[providerId]`)
  6) optional: prompt to set default model (or defer to `/model`)

#### 6.4.2 Update `dexto setup` onboarding
- Make `dexto setup` call the same underlying “connect provider” logic, rather than duplicating API key prompts.
- If `dexto-nova` is enabled, keep the current “login to Dexto” path as the simplest default, but allow “connect other providers” as a branch.
- Ensure “method choice” is provider-aware (OpenAI: OAuth vs BYOK).

### 6.5 LLM factory integration (runtime correctness)

Extend `packages/core/src/llm/services/factory.ts`:
- Replace `resolveApiKeyForProvider(provider)` with a new resolver that can return:
  - BYOK API key, or
  - OAuth-based runtime overrides for the provider.

Initial target integrations:
- **OpenAI**
  - `api_key` → current behavior
  - `chatgpt_oauth_codex` → custom fetch:
    - strip the SDK’s Authorization header
    - inject `Bearer <access token>`
    - refresh token when expired
    - rewrite to Codex endpoint when calling Responses API
- **Anthropic**
  - `api_key` → current behavior
  - `setup_token` → treat token as the API key material if compatible with `@ai-sdk/anthropic`
- **Bedrock**
  - keep AWS chain behavior
  - add a “bearer token” method as a first-class connect option that stores `AWS_BEARER_TOKEN_BEDROCK`

### 6.6 Provider expansion strategy (“more providers”)

We should expand providers in two tiers:

**Tier 1: native SDK providers we already basically support via OpenRouter/LiteLLM, but want first-class**
- Add `mistral`, `perplexity`, `together`, `deepseek`, `fireworks`, etc **only if**
  - we can implement them cleanly in `factory.ts` using existing AI SDK packages, and
  - we can define a stable env var + API key validation story.

**Tier 2: “use gateway”**
- For everything else, steer to:
  - `openrouter` (BYOK) or
  - `litellm` (self-hosted) or
  - `dexto-nova` (Dexto account)

---

## 7. Provider / Method Matrix (Initial)

| Provider | Methods to support in v1 | Notes |
|---|---|---|
| `dexto-nova` | Dexto login (existing) | WebUI currently instructs CLI login; keep that but expose status/methods via API. |
| `openai` | API key, ChatGPT OAuth (Codex) | OAuth requires request rewrite + refresh (see OpenCode plugin). |
| `anthropic` | API key, setup-token | Depends on token compatibility; if not viable, fallback to API key only. |
| `google` | API key | (Optional later) add Gemini CLI/Code Assist OAuth patterns if we see value. |
| `bedrock` | AWS chain, bearer token | Make bearer-token connect UX explicit; keep “chain” guidance. |
| `vertex` | ADC | Expose a “connect” flow that teaches `gcloud auth application-default login` + required env vars. |
| `openrouter` | API key | Already. |
| `litellm` | API key + baseURL | Already via setup/custom model. |
| `openai-compatible` | API key + baseURL + custom models | Already via custom model wizard; integrate with /connect for the provider-level credential if desired. |
| `glama` | API key | Already. |

---

## 8. Tasklist

### Phase 0 — Decisions + interface design
> **Goal:** settle storage/layout and define the internal shapes so CLI/WebUI/server can share a single source of truth.

- [ ] **0.1 Decide auth storage layout + migration**
  - Deliverables:
    - Final on-disk layout for Dexto auth + LLM provider profiles (including permissions).
    - Migration story from legacy `~/.dexto/auth.json`.
  - Exit:
    - `USER_VERIFICATION.md` contains the resolved decision and any explicit follow-ups.

- [ ] **0.2 Define provider auth method + profile types**
  - Deliverables:
    - `ProviderAuthMethod`, `ProviderAuthMethodKind`, `ProviderAuthResult`, `ProviderRuntimeAuth`.
    - `ProviderCredentialProfile` (stored credential material).
  - Exit:
    - Shared types are defined with no “shadow copies” (server + CLI consume the same types).

- [ ] **0.3 Decide resolution precedence + config surface**
  - Deliverables:
    - Final precedence rules for `llm.apiKey` / `llm.authProfileId` / defaults / env.
    - Decision whether we ship `llm.authProfileId` in v1.
  - Exit:
    - `USER_VERIFICATION.md` marks the decision resolved.

### Phase 1 — Scaffolding + API surface (API keys + profile plumbing)
> **Goal:** ship a first working `/connect` for API-key methods + a stable server API surface for WebUI parity.

- [ ] **1.1 Add LLM profile store in `@dexto/agent-management`**
  - Deliverables:
    - Read/write `llm-profiles.json` (or chosen store) with `0o600` files and atomic writes.
    - List/upsert/delete profiles; set per-provider default.
  - Exit:
    - Unit coverage for parsing + write safety + basic CRUD.

- [ ] **1.2 Add server routes for methods/profiles/defaults/status**
  - Deliverables:
    - Hono routes in `packages/server/src/hono/routes/` for methods, profiles, defaults, status.
    - Keep `/llm/key` working; decide whether to alias/migrate it.
  - Exit:
    - Routes return stable JSON shapes and secrets are never returned.

- [ ] **1.3 Add CLI interactive `/connect` (API key methods first)**
  - Deliverables:
    - New interactive command in `packages/cli/src/cli/commands/interactive-commands/`.
    - Flow: choose provider → choose method → complete method → set default.
    - Ability to switch default without re-auth (if multiple profiles exist).
  - Exit:
    - Manual CLI smoke: connect an API-key provider, set default, and confirm Dexto can run using it.

- [ ] **1.4 Route `dexto setup` through the same connect logic**
  - Deliverables:
    - `dexto setup` reuses `/connect` internals rather than duplicating provider auth prompts.
  - Exit:
    - Setup path still works for Dexto login and at least one BYOK provider.

### Phase 2 — OpenAI ChatGPT OAuth (Codex)
> **Goal:** make OAuth a first-class method whose tokens affect runtime requests (not just storage).

- [ ] **2.1 Implement OpenAI OAuth authorize/callback flows + persistence**
  - Deliverables:
    - OAuth flow helper that supports local browser callback and headless/device-code paths.
    - Persist token + refresh metadata in the profile store.
  - Exit:
    - Manual OAuth connect succeeds; token is stored; secrets are not logged.

- [ ] **2.2 Implement refresh token logic**
  - Deliverables:
    - Refresh on expiry with safe concurrent refresh behavior.
  - Exit:
    - Unit tests cover refresh success/failure and persistence updates.

- [ ] **2.3 Implement runtime wiring in `packages/core/src/llm/services/factory.ts`**
  - Deliverables:
    - Provider-specific runtime overrides for OpenAI OAuth (headers/fetch/baseURL/URL rewrite as needed).
  - Exit:
    - Regression tests cover request rewrite correctness (unit-level; network mocked).

### Phase 3 — Anthropic setup-token (subscription) (if viable)
> **Goal:** add a second “non-api-key” method to validate the model.

- [ ] **3.1 Add `setup-token` method UX + storage**
  - Exit:
    - Token is stored as a profile and can be selected as default.

- [ ] **3.2 Validate runtime compatibility**
  - Exit:
    - Confirm compatibility with `@ai-sdk/anthropic`, or explicitly defer/remove this method for v1.

### Phase 4 — Bedrock + Vertex first-class connect UX
> **Goal:** make non-key providers feel “connectable” (guided setup) even if they use ADC/credential chains.

- [ ] **4.1 Add Bedrock connect UX (chain vs bearer token)**
  - Exit:
    - Clear UX for “store bearer token” and “use AWS credential chain” paths.

- [ ] **4.2 Add Vertex connect UX (ADC guidance)**
  - Exit:
    - UX clearly guides `gcloud auth application-default login` + required env vars.

### Phase 5 — WebUI parity
> **Goal:** WebUI reflects the same method-based auth model as the CLI.

- [ ] **5.1 Add “Connect provider” UI**
  - Exit:
    - WebUI can list providers, show methods, and connect at least API-key methods via server API.

- [ ] **5.2 Update “API keys” settings panel**
  - Exit:
    - WebUI shows connection status by method (not only “key exists”).

---

## 9. Security / UX Notes

- OAuth should support **headless** environments (device-code or “paste redirect URL” flows).
- Store secrets with `0o600` and avoid logging.
- If we keep localhost callback servers, ensure:
  - random `state` + verification (OpenCode does; our current Supabase flow has limitations).
  - short timeouts + clear cancellation paths.
- Prefer device-code where the upstream supports it (OpenCode’s headless ChatGPT method is a good template).

---

## 10. Open Questions (tracked for owner)

Owner-only questions and manual checks are tracked in `USER_VERIFICATION.md` (each item should map to a UV-* entry). Keep this section as a pointer, not a second source of truth.
