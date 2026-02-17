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
- **Provider key storage helpers** live in `@dexto/agent-management`:
  - `packages/agent-management/src/utils/api-key-store.ts` (`saveProviderApiKey()`, `getProviderKeyStatus()`, Bedrock special-casing)
  - `packages/agent-management/src/utils/api-key-resolver.ts` (env var resolution mirror)
- **Dexto account login** state lives in `~/.dexto/auth.json` (see `packages/cli/src/cli/auth/service.ts` and `packages/agent-management/src/utils/dexto-auth.ts`). The CLI loads `DEXTO_API_KEY` from this file early (`packages/cli/src/index-main.ts`) for `dexto-nova` routing.

We want:
- **Per-provider auth method selection** (e.g. OpenAI: ChatGPT OAuth *or* API key).
- A clear **/connect** experience from the interactive CLI (and a corresponding WebUI flow).
- A single internal shape for “a provider supports these login methods”, so UX and behavior match what’s truly supported.

Known complications / gaps:
- **OpenAI Codex OAuth may require allowlisting** (expected failure mode for many accounts). We must implement it with graceful fallback messaging to API key mode.
- **OAuth client IDs / redirect URIs are product-critical**. We must use Dexto-owned OAuth app credentials (don’t copy OpenCode/OpenClaw client IDs). Redirect URIs must be registered; some providers may require allowlisting for our app.
- **Anthropic setup-token viability is uncertain** (we should implement until proven infeasible, then gate/remove).
- **Provider IDs are currently fixed** (`LLM_PROVIDERS` enum in `packages/core/src/llm/types.ts`). Supporting `moonshot`, `zai`, `minimax-cn`, etc. as first-class providers requires either:
  - expanding the enum + LLM factory support, or
  - treating them as `openai-compatible` presets (provider-specific baseURL + env-var naming) without adding new provider IDs.

---

## 2. Goals

- Add a **`/connect`** interactive CLI command to connect a provider via one of its supported methods.
- Support **multiple login methods per provider** (when available), at minimum:
  - **OpenAI**: API key + ChatGPT OAuth (Codex-style).
  - **Anthropic**: API key + subscription token (“setup-token” flow, if viable).
  - **Bedrock**: AWS bearer token + AWS credential chain guidance.
- Expand first-class provider support for key ecosystems we care about:
  - **MiniMax**: API key (OpenAI-compatible) + MiniMax Portal OAuth (device-code style) + CN endpoint presets.
  - **GLM / Z.AI**: API key + endpoint presets (coding/global, global/CN).
  - **Kimi (Moonshot)**: API key + global/CN endpoint presets.
- Make provider auth **runtime-affecting**:
  - OAuth tokens should be refreshable without forcing the user to re-login.
  - The LLM factory should be able to apply provider-specific runtime options (headers/fetch/baseURL) depending on the active auth method.
- Keep **models.dev as the model registry source of truth** (we already do).
- Use models.dev metadata to reduce churn when expanding supported providers/models (connect UI list, env-var expectations, curated defaults).

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
  - Credential + store types: `~/Projects/external/openclaw/src/agents/auth-profiles/types.ts`
  - Store persistence + locking + legacy coercion: `~/Projects/external/openclaw/src/agents/auth-profiles/store.ts`
  - Key resolver (including OAuth refresh + fallback behaviors): `~/Projects/external/openclaw/src/agents/auth-profiles/oauth.ts`

### 4.3 OAuth flows with “VPS-aware” UX
- Shared helper supports:
  - local browser open + localhost callback, OR
  - remote/VPS mode that prints a URL and asks user to paste redirect/code.
  - Source: `~/Projects/external/openclaw/src/commands/oauth-flow.ts` (`createVpsAwareOAuthHandlers()`)

### 4.4 Provider auth plugins return “config patch + credentials”
- Provider plugins return:
  - profiles to store,
  - `configPatch` (models/providers + defaults),
  - `defaultModel` suggestion,
  - notes.
  - Source types: `~/Projects/external/openclaw/src/plugins/types.ts` (`ProviderPlugin`, `ProviderAuthMethod`, `ProviderAuthResult`)
  - Example OAuth provider plugin: `~/Projects/external/openclaw/extensions/minimax-portal-auth/index.ts`
  - Example OAuth device-code/PKCE implementation: `~/Projects/external/openclaw/extensions/minimax-portal-auth/oauth.ts`

### 4.5 Model catalog is *not* models.dev
- OpenClaw uses `@mariozechner/pi-ai` model registry + `models.json` generation, and only bridges certain OAuth creds into `auth.json` for discovery.
  - Source: `~/Projects/external/openclaw/src/agents/model-catalog.ts`

### 4.6 Provider presets (base URLs, default models, endpoints)
- MiniMax provider config (OpenAI-compatible + Anthropic-compatible + CN variants):
  - `~/Projects/external/openclaw/src/commands/onboard-auth.models.ts`
  - `~/Projects/external/openclaw/src/commands/onboard-auth.config-minimax.ts`
- Kimi (Moonshot) presets (global + CN base URLs):
  - `~/Projects/external/openclaw/src/commands/onboard-auth.models.ts`
  - `~/Projects/external/openclaw/src/commands/onboard-auth.config-core.ts` (`applyMoonshot*`)
- Z.AI / GLM presets (coding/global, global/CN endpoints):
  - `~/Projects/external/openclaw/src/commands/onboard-auth.models.ts`
  - `~/Projects/external/openclaw/src/commands/onboard-auth.config-core.ts` (`applyZai*`)

### 4.7 Anthropic “setup-token” (subscription token) flow
- Interactive prompting + applying setup-token auth choice:
  - `~/Projects/external/openclaw/src/commands/auth-choice.apply.anthropic.ts`
  - `~/Projects/external/openclaw/src/commands/models/auth.ts`
- Viability checks (live test scaffolding): `~/Projects/external/openclaw/src/agents/anthropic.setup-token.live.test.ts`

### 4.8 Auth resolution precedence + env var mapping
- OpenClaw’s provider auth resolution is effectively:
  1) explicit `profileId` (if passed),
  2) profile order (from store override or config),
  3) env var mapping (including `*_OAUTH_TOKEN` fallbacks),
  4) provider config `models.json` overrides.
  - Resolver: `~/Projects/external/openclaw/src/agents/model-auth.ts` (`resolveApiKeyForProvider()`, `resolveEnvApiKey()`)
  - Order logic: `~/Projects/external/openclaw/src/agents/auth-profiles/order.ts` (`resolveAuthProfileOrder()`)

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
  - TUI (terminal) equivalent: `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx`
- CLI equivalent: `opencode auth login`
  - Source: `~/Projects/external/opencode/packages/opencode/src/cli/cmd/auth.ts`

### 5.2 Provider/model catalog from models.dev
- Providers/models are fetched + cached from models.dev:
  - Source: `~/Projects/external/opencode/packages/opencode/src/provider/models.ts`
- OpenCode uses **provider metadata** from models.dev to drive UX and runtime:
  - `provider.env` (recommended env var names)
  - `provider.api` (base URL for OpenAI/Anthropic-compatible endpoints)
  - `provider.npm` (recommended Vercel AI SDK package, e.g. `@ai-sdk/openai-compatible` vs `@ai-sdk/anthropic`)
  - `provider.doc` (docs link)
  - Source: `~/Projects/external/opencode/packages/opencode/src/provider/provider.ts` (`fromModelsDevProvider()`, `fromModelsDevModel()`)
- Provider registry merges:
  - models.dev → config overrides → env vars → stored keys → plugin OAuth → custom loaders
  - Source: `~/Projects/external/opencode/packages/opencode/src/provider/provider.ts`
  - Stored credential file shape + permissions: `~/Projects/external/opencode/packages/opencode/src/auth/index.ts` (writes `auth.json` with `0o600`)

### 5.3 Plugin auth methods for “OAuth vs API key” per provider
- Auth methods are per provider and can include multiple methods.
- OpenAI plugin supports both ChatGPT OAuth (browser callback + device-code) and API key.
  - Source: `~/Projects/external/opencode/packages/opencode/src/plugin/codex.ts`
- GitHub Copilot uses device-code and supports enterprise variant selection.
  - Source: `~/Projects/external/opencode/packages/opencode/src/plugin/copilot.ts`
 - Server-side two-phase OAuth orchestration (authorize → callback) and pending-state handling:
   - `~/Projects/external/opencode/packages/opencode/src/provider/auth.ts`
   - `~/Projects/external/opencode/packages/opencode/src/server/routes/provider.ts`

### 5.4 OAuth is *runtime-affecting*, not just “store a token”
- For ChatGPT OAuth, the plugin:
  - injects `Authorization: Bearer <access token>`
  - rewrites requests to `https://chatgpt.com/backend-api/codex/responses`
  - refreshes the access token when expired
  - Source: `~/Projects/external/opencode/packages/opencode/src/plugin/codex.ts`
   - Key implementation details worth copying (see `CodexAuthPlugin()`):
     - Localhost PKCE callback server (default port `1455`) + `state` verification
     - Headless device-code flow (`/api/accounts/deviceauth/usercode` → poll `/api/accounts/deviceauth/token`)
     - Token exchange/refresh against `${ISSUER}/oauth/token`
     - Request rewrite triggers on `/v1/responses` and `/chat/completions`
     - Optional `ChatGPT-Account-Id` header derived from JWT claims (`id_token` / `access_token`)

Key takeaways to borrow:
- A first-class **/connect** UX.
- A method list per provider, where OAuth methods are **two-phase** (authorize → callback).
- OAuth methods that can return **runtime request overrides** (headers/fetch/url rewriting).
- Strong alignment between **provider catalog** and **what can actually be connected**.

---

## 6. Provider/Auth method diff (OpenCode vs OpenClaw vs Dexto)

### 6.1 Dexto today (in this repo)
- Fixed provider enum: `packages/core/src/llm/types.ts` (`LLM_PROVIDERS`)
- API key resolution: `packages/core/src/utils/api-key-resolver.ts`, `packages/agent-management/src/utils/api-key-resolver.ts`
- Persisted API keys (writes `.env`): `packages/agent-management/src/utils/api-key-store.ts`, server route `packages/server/src/hono/routes/key.ts`
- Dexto login state (for `dexto-nova`): `packages/cli/src/cli/auth/service.ts` (writes `~/.dexto/auth.json`), env injection `packages/cli/src/index-main.ts`

### 6.2 OpenCode today (reference)
- Auth storage (`auth.json`, `0o600`): `~/Projects/external/opencode/packages/opencode/src/auth/index.ts`
- Provider auth orchestration (two-phase authorize/callback + pending-state): `~/Projects/external/opencode/packages/opencode/src/provider/auth.ts`
- Server routes: `~/Projects/external/opencode/packages/opencode/src/server/routes/provider.ts`
- OAuth implementations:
  - OpenAI Codex (PKCE + device-code + runtime request rewrite): `~/Projects/external/opencode/packages/opencode/src/plugin/codex.ts`
  - GitHub Copilot (device-code + header rewrite + enterprise prompts): `~/Projects/external/opencode/packages/opencode/src/plugin/copilot.ts`

### 6.3 OpenClaw today (reference)
- Provider/method choice grouping: `~/Projects/external/openclaw/src/commands/auth-choice-options.ts`, `~/Projects/external/openclaw/src/commands/auth-choice-prompt.ts`
- Provider plugin auth surface: `~/Projects/external/openclaw/src/plugins/types.ts`
- Auth profile store + refresh/locking: `~/Projects/external/openclaw/src/agents/auth-profiles/store.ts`, `~/Projects/external/openclaw/src/agents/auth-profiles/oauth.ts`
- MiniMax portal OAuth (device-code/PKCE style): `~/Projects/external/openclaw/extensions/minimax-portal-auth/oauth.ts`
- Z.AI / Moonshot presets: `~/Projects/external/openclaw/src/commands/onboard-auth.models.ts`, `~/Projects/external/openclaw/src/commands/onboard-auth.config-core.ts`

### 6.4 Side-by-side provider/method matrix (detailed, in-scope)

| Provider / group | OpenCode methods | OpenClaw methods | Dexto today | Dexto planned (v1) |
|---|---|---|---|---|
| `openai` | OAuth (ChatGPT Pro/Plus browser + headless) + API key (`~/Projects/external/opencode/packages/opencode/src/plugin/codex.ts`) | `openai-codex` (OAuth), `openai-api-key` (API key) (`~/Projects/external/openclaw/src/commands/auth-choice-options.ts`) | API key via env vars (`OPENAI_API_KEY`, `OPENAI_KEY`) | API key + Codex OAuth (browser + headless), allowlist-aware UX + runtime request rewrite |
| `anthropic` | API key | `token` / `setup-token` (paste), `apiKey` (API key) (`~/Projects/external/openclaw/src/commands/auth-choice.apply.anthropic.ts`) | API key via env vars (`ANTHROPIC_API_KEY`, etc.) | API key + setup-token (implement; gate/remove if infeasible) |
| `minimax` | API key (models.dev provider ID `minimax`, `minimax-coding-plan`) | `minimax-portal` (OAuth), plus API key presets (`minimax-api`, `minimax-api-key-cn`, `minimax-api-lightning`) (`~/Projects/external/openclaw/src/commands/auth-choice-options.ts`, `~/Projects/external/openclaw/extensions/minimax-portal-auth/oauth.ts`, `~/Projects/external/openclaw/src/commands/onboard-auth.config-minimax.ts`) | Provider exists (`minimax`) but current runtime assumes OpenAI-compatible baseURL (`packages/core/src/llm/services/factory.ts`) | API key presets (global/CN + coding-plan variants) + MiniMax Portal OAuth method; align runtime transport with models.dev + OpenClaw endpoint variants |
| `moonshotai` (Kimi) | API key (models.dev provider IDs `moonshotai`, `moonshotai-cn`) | `moonshot-api-key` (global), `moonshot-api-key-cn` (CN) (`~/Projects/external/openclaw/src/commands/auth-choice-options.ts`) | Not first-class provider ID; can be used via `openai-compatible` manually | Add Moonshot presets (global + CN) with models.dev provider IDs and OpenClaw baseURL constants; optionally add a first-class provider ID (Phase 0.2) |
| `kimi-for-coding` (Kimi Code) | API key (models.dev provider ID `kimi-for-coding`) | `kimi-code-api-key` (API key) (`~/Projects/external/openclaw/src/commands/auth-choice.apply.api-providers.ts`) | Not supported | Add Kimi Code preset (Anthropic-compatible) + API key connect method; ensure runtime can target Anthropic-compatible endpoints |
| `zhipuai` (GLM / BigModel) | API key (models.dev provider IDs `zhipuai`, `zhipuai-coding-plan`) | (OpenClaw’s “CN” Z.AI endpoints point at `open.bigmodel.cn`) (`~/Projects/external/openclaw/src/commands/onboard-auth.models.ts`) | Supported as provider `glm` with fixed baseURL `https://open.bigmodel.cn/api/paas/v4` (`packages/core/src/llm/services/factory.ts`) | Add presets for Zhipu base URLs (standard + coding plan), and decide whether to alias `glm` ↔ `zhipuai` in UX/config (Phase 0.2) |
| `zai` (Z.AI) | API key (models.dev provider IDs `zai`, `zai-coding-plan`) | `zai-*` endpoint presets (`zai-coding-global`, `zai-coding-cn`, `zai-global`, `zai-cn`) (`~/Projects/external/openclaw/src/commands/auth-choice-options.ts`, `~/Projects/external/openclaw/src/commands/onboard-auth.models.ts`) | Not first-class (closest is `glm` for `open.bigmodel.cn`) | Add Z.AI presets and decide env var mapping (`ZHIPU_API_KEY` per models.dev vs `ZAI_API_KEY` per OpenClaw) (Phase 0.2) |
| `bedrock` | (API key/creds) | (N/A) | AWS chain in factory; bearer token is recognized in status helpers (`packages/agent-management/src/utils/api-key-store.ts`) | `/connect` guidance + explicit method choices |
| `vertex` | ADC | (N/A) | ADC-only (`GOOGLE_VERTEX_PROJECT`, etc.) | `/connect` guidance + status surface |
| `openrouter` | API key | `openrouter-api-key` | API key env var | Add profiles + `/connect` UX + status |
| `litellm` | API key + baseURL | `litellm-api-key` | API key env var + baseURL required | Add profiles + `/connect` UX for baseURL + key |
| `dexto-nova` | (N/A) | (N/A) | Dexto login (`~/.dexto/auth.json` → `DEXTO_API_KEY`) | Move to new auth store + expose status/methods via API |

### 6.4.1 Additional OAuth/token methods in prior art (useful references; not required for v1 unless requested)

| Provider / group | OpenCode | OpenClaw | What this teaches us |
|---|---|---|---|
| `github-copilot` | OAuth device-code + enterprise prompts (`~/Projects/external/opencode/packages/opencode/src/plugin/copilot.ts`) | `github-copilot` / `copilot-proxy` (`~/Projects/external/openclaw/src/commands/auth-choice-options.ts`) | Device-code UX, multi-tenant baseURL handling, runtime header rewrite |
| `qwen-portal` | (API key default) | OAuth portal (`~/Projects/external/openclaw/src/commands/auth-choice-options.ts`) | Second OAuth provider beyond OpenAI/MiniMax |
| `chutes` | (API key default) | OAuth (`~/Projects/external/openclaw/src/commands/auth-choice-options.ts`) | Third OAuth provider; token-as-key patterns |
| `google-gemini-cli` / `google-antigravity` | (API key default) | OAuth (`~/Projects/external/openclaw/src/commands/auth-choice-options.ts`) | Headless OAuth UX and ADC-adjacent guidance |

**Key gap today:** Dexto has no persisted per-provider profiles, no method registry, and no OAuth/device-code flows besides Dexto login for `dexto-nova`.

### 6.5 Concrete provider endpoint + env-var diffs (models.dev vs OpenClaw vs Dexto)

This is the “actionable diff” for GLM/Z.AI, MiniMax, and Kimi/Moonshot. It’s the minimum reference set needed while implementing presets and picking transports.

| Ecosystem | models.dev (provider IDs → baseURL/API + env + SDK hint) | OpenClaw (provider IDs/choices → baseURL + env) | Dexto today (provider → baseURL + env) | Implication for this plan |
|---|---|---|---|---|
| **MiniMax** | `minimax` → `https://api.minimax.io/anthropic/v1`, `MINIMAX_API_KEY`, `@ai-sdk/anthropic` | `minimax` OpenAI-compatible: `DEFAULT_MINIMAX_BASE_URL = https://api.minimax.io/v1` (`onboard-auth.models.ts`); Anthropic-compatible: `MINIMAX_API_BASE_URL = https://api.minimax.io/anthropic`, `MINIMAX_CN_API_BASE_URL = https://api.minimaxi.com/anthropic` (`onboard-auth.config-minimax.ts`); env: `MINIMAX_API_KEY` / `MINIMAX_OAUTH_TOKEN` (`model-auth.ts`) | `minimax` → `https://api.minimax.chat/v1` + `MINIMAX_API_KEY` (`packages/core/src/llm/services/factory.ts`, `packages/core/src/utils/api-key-resolver.ts`) | MiniMax has **multiple official surfaces** (OpenAI-compatible vs Anthropic-compatible vs Portal OAuth). Our presets must choose a default and also expose variants. Expect we’ll need an **Anthropic-compatible runtime path** for models.dev alignment (and/or keep OpenAI-compatible as an optional preset). |
| **MiniMax (CN)** | `minimax-cn` → `https://api.minimaxi.com/anthropic/v1`, `MINIMAX_API_KEY`, `@ai-sdk/anthropic` | `minimax-api-key-cn` choice uses `api.minimaxi.com` (`auth-choice-options.ts`) + `MINIMAX_CN_API_BASE_URL` (`onboard-auth.config-minimax.ts`) | no first-class CN preset | Add CN preset(s) and make region explicit in `/connect`. |
| **Moonshot (Kimi)** | `moonshotai` → `https://api.moonshot.ai/v1`, `MOONSHOT_API_KEY`, `@ai-sdk/openai-compatible`; `moonshotai-cn` → `https://api.moonshot.cn/v1` | `moonshot` provider: `MOONSHOT_BASE_URL`, `MOONSHOT_CN_BASE_URL` (`onboard-auth.models.ts` / `onboard-auth.config-core.ts`); env: `MOONSHOT_API_KEY` (`model-auth.ts`) | not first-class; can be used via `openai-compatible` if user supplies `baseURL` + key | Moonshot is a clean **OpenAI-compatible preset**. We should ship both baseURLs + a small curated model list. |
| **Kimi Code / “for coding”** | `kimi-for-coding` → `https://api.kimi.com/coding/v1`, `KIMI_API_KEY`, `@ai-sdk/anthropic` | `kimi-coding` provider + `kimi-code-api-key` choice (`auth-choice.apply.api-providers.ts`); env: `KIMI_API_KEY` / `KIMICODE_API_KEY` (`model-auth.ts`) | not supported | This is an **Anthropic-compatible preset** (not OpenAI-compatible). Plan should include an Anthropic-compatible runtime transport/preset path. |
| **Zhipu AI (GLM / BigModel)** | `zhipuai` → `https://open.bigmodel.cn/api/paas/v4`, `ZHIPU_API_KEY`, `@ai-sdk/openai-compatible`; `zhipuai-coding-plan` → `https://open.bigmodel.cn/api/coding/paas/v4` | OpenClaw’s “CN” Z.AI endpoints also point at `open.bigmodel.cn` (`onboard-auth.models.ts`); env: `ZHIPU_API_KEY` (`model-auth.ts`) | `glm` → `https://open.bigmodel.cn/api/paas/v4` + `ZHIPU_API_KEY` | Dexto’s `glm` is already close to models.dev’s `zhipuai`. We should decide whether to alias/rename for consistency and add coding-plan presets. |
| **Z.AI (GLM / global)** | `zai` → `https://api.z.ai/api/paas/v4`, `ZHIPU_API_KEY`, `@ai-sdk/openai-compatible`; `zai-coding-plan` → `https://api.z.ai/api/coding/paas/v4` | OpenClaw uses baseURLs `api.z.ai` + `open.bigmodel.cn` variants (`onboard-auth.models.ts`), but env mapping differs: `ZAI_API_KEY` / `Z_AI_API_KEY` for `zai` (`model-auth.ts`) | no first-class; closest is `glm` | We need an owner decision: accept both env var schemes and/or prefer models.dev’s `ZHIPU_API_KEY`. Connect UX should make this explicit to avoid surprise. |

---

## 7. Proposed Dexto Design

### 7.1 Unify “provider auth methods” (types + registry)

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

Reference shapes worth copying:
- OpenCode provider auth types + server orchestration:
  - `~/Projects/external/opencode/packages/opencode/src/provider/auth.ts` (`ProviderAuth.Method`, `ProviderAuth.Authorization`, `authorize()`, `callback()`)
  - `~/Projects/external/opencode/packages/opencode/src/server/routes/provider.ts` (`/:providerID/oauth/authorize` and `/:providerID/oauth/callback`)
- OpenClaw provider auth plugin types (profiles + config patch concept):
  - `~/Projects/external/openclaw/src/plugins/types.ts` (`ProviderAuthMethod`, `ProviderAuthResult`, `ProviderAuthContext`)

### 7.2 Credential storage: provider credentials + active method

We need to support:
- multiple saved credential profiles per provider
- a per-provider default profile (so most users never touch agent config)
- OAuth refresh metadata (expires, refresh token, account/org ids)

Proposed on-disk layout (subject to owner verification in `USER_VERIFICATION.md`):
- `~/.dexto/auth/` (new, `0o700`)
  - `dexto.json` — Dexto account login state (replaces legacy `~/.dexto/auth.json`).
  - `llm-profiles.json` — LLM provider credential profiles + defaults.

Backwards compatibility:
- **Explicit non-goal:** we do not maintain compatibility with `~/.dexto/auth.json`.
- We will require the user to re-login to populate `~/.dexto/auth/dexto.json` (optionally we can add a one-time import command later, but it is not required for v1).

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

Decision pending: whether precedence should be **hardcoded** (simple, predictable) vs **configured in the profile store** (more flexible, higher complexity). Candidate directions:
- **A: Hardcoded precedence (default)** — keep the list above; `llm.apiKey` remains the “escape hatch”.
- **B: Store-driven precedence** — profile store contains per-provider default + optional per-agent override, and env vars become a fallback that can be toggled/disabled.
- **C: “Profiles only” mode** — agent config never contains raw API keys; `/connect` becomes the single supported way to persist credentials.

Reference implementations:
- OpenCode auth storage (single auth entry per provider): `~/Projects/external/opencode/packages/opencode/src/auth/index.ts`
- OpenClaw auth profile store (multiple profiles + refresh + file locking): `~/Projects/external/openclaw/src/agents/auth-profiles/store.ts`, `~/Projects/external/openclaw/src/agents/auth-profiles/types.ts`, `~/Projects/external/openclaw/src/agents/auth-profiles/oauth.ts`
- Dexto current Dexto-account auth file (legacy): `packages/cli/src/cli/auth/service.ts`, `packages/agent-management/src/utils/dexto-auth.ts`

### 7.3 Server API (for WebUI + future remote clients)

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

Reference server API:
- OpenCode routes: `~/Projects/external/opencode/packages/opencode/src/server/routes/provider.ts` (GET `/providers/auth`, POST `/:providerID/oauth/authorize`, POST `/:providerID/oauth/callback`)
- OpenCode orchestration + pending-state: `~/Projects/external/opencode/packages/opencode/src/provider/auth.ts`
- Dexto existing API-key route: `packages/server/src/hono/routes/key.ts`

### 7.4 CLI UX

#### 7.4.1 New interactive command: `/connect`
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

Reference UX flows:
- OpenCode CLI flow (method selection + auto/code handling + extra prompts): `~/Projects/external/opencode/packages/opencode/src/cli/cmd/auth.ts` (`handlePluginAuth()`)
- OpenCode TUI dialog flow: `~/Projects/external/opencode/packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx`
- OpenClaw grouped provider → method prompt: `~/Projects/external/openclaw/src/commands/auth-choice-prompt.ts`, `~/Projects/external/openclaw/src/commands/auth-choice-options.ts`

#### 7.4.2 Update `dexto setup` onboarding
- Make `dexto setup` call the same underlying “connect provider” logic, rather than duplicating API key prompts.
- If `dexto-nova` is enabled, keep the current “login to Dexto” path as the simplest default, but allow “connect other providers” as a branch.
- Ensure “method choice” is provider-aware (OpenAI: OAuth vs BYOK).

### 7.5 LLM factory integration (runtime correctness)

Extend `packages/core/src/llm/services/factory.ts`:
- Replace `resolveApiKeyForProvider(provider)` with a new resolver that can return:
  - BYOK API key, or
  - OAuth-based runtime overrides for the provider.

Reference runtime override patterns:
- OpenCode Codex runtime override: `~/Projects/external/opencode/packages/opencode/src/plugin/codex.ts` (strip auth header, set Bearer token, rewrite URL, refresh on expiry, optional `ChatGPT-Account-Id`)
- OpenCode Copilot runtime override: `~/Projects/external/opencode/packages/opencode/src/plugin/copilot.ts` (device-code auth + header rewrite + enterprise baseURL)
- OpenClaw OAuth refresh-with-lock pattern: `~/Projects/external/openclaw/src/agents/auth-profiles/oauth.ts` (`withFileLock` + refresh + persist)
- Dexto current factory: `packages/core/src/llm/services/factory.ts`

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

### 7.6 Provider expansion strategy (“more providers”)

Since Dexto already consumes models.dev, we can expand providers in tiers with minimal churn by separating:
1) **Catalog/UX** (provider list + models + env var expectations), and
2) **Runtime transport** (how we actually talk to the provider).

Implementation note (important):
- Our current models.dev sync (`scripts/sync-llm-registry.ts`) only snapshots **models**, and discards provider-level fields we need for “more providers” UX (`provider.api`, `provider.env`, `provider.npm`, `provider.doc`).
- Options:
  - Extend the generator to emit provider metadata (e.g. `packages/core/src/llm/registry/providers.generated.ts`) and use it in `/connect`.
  - Or fetch provider metadata at runtime and cache it (mirroring `packages/core/src/llm/registry/auto-update.ts` patterns).
- Reference implementation: OpenCode’s models.dev provider transform is already built around these fields (`~/Projects/external/opencode/packages/opencode/src/provider/provider.ts`).

**Tier 1: first-class providers (minimal work)**
- **OpenAI-compatible providers with stable base URLs** (can be implemented as presets + `createOpenAI(...).chat()` in `factory.ts`):
  - Examples (models.dev-aligned): `moonshotai` / `moonshotai-cn` (Kimi), `zhipuai` / `zhipuai-coding-plan` (GLM via `open.bigmodel.cn`), `zai` / `zai-coding-plan` (GLM via `api.z.ai`), and other OpenAI-compatible endpoints surfaced via models.dev.
  - Requirements:
    - stable baseURL (or a small set of well-known baseURL variants)
    - stable env var mapping
    - no special request signing
- **Anthropic-compatible providers with stable base URLs** (can be implemented as presets + `createAnthropic({ baseURL }).messages()`):
  - Examples (models.dev-aligned): `minimax` / `minimax-cn` and `kimi-for-coding`.
- **Providers with specialized SDKs/signing** (Bedrock, Vertex, etc.) stay explicit and require targeted runtime work.

**Tier 2: “use gateway”**
- For everything else, steer to:
  - `openrouter` (BYOK) or
  - `litellm` (self-hosted) or
  - `dexto-nova` (Dexto account)

---

## 8. Provider / Preset / Method Matrix (Initial)

| Provider / preset | Methods to support in v1 | Notes |
|---|---|---|
| `dexto-nova` | Dexto login (existing) | WebUI currently instructs CLI login; keep that but expose status/methods via API. |
| `openai` | API key, ChatGPT OAuth (Codex) | OAuth requires request rewrite + refresh (see OpenCode plugin). |
| `anthropic` | API key, setup-token | Depends on token compatibility; if not viable, fallback to API key only. |
| `google` | API key | (Optional later) add Gemini CLI/Code Assist OAuth patterns if we see value. |
| `minimax` / `minimax-cn` | API key, MiniMax Portal OAuth, CN presets | models.dev indicates Anthropic-compatible baseURLs; OpenClaw also supports OpenAI-compatible variants. We should ship presets for both and choose a default. |
| `moonshotai` / `moonshotai-cn` | API key, global/CN presets | OpenAI-compatible; models.dev provides canonical baseURLs + env var hints; OpenClaw presets also exist. |
| `kimi-for-coding` | API key | Anthropic-compatible preset (distinct from Moonshot). |
| `zhipuai` / `zhipuai-coding-plan` | API key, endpoint presets | OpenAI-compatible; likely aliases Dexto’s current `glm` (owner decision). |
| `zai` / `zai-coding-plan` | API key, endpoint presets | OpenAI-compatible; env var mapping differs between models.dev and OpenClaw (Phase 0.2). |
| `glm` | API key | Existing Dexto provider; decide whether it becomes an alias to `zhipuai` or remains as-is (Phase 0.2). |
| `bedrock` | AWS chain, bearer token | Make bearer-token connect UX explicit; keep “chain” guidance. |
| `vertex` | ADC | Expose a “connect” flow that teaches `gcloud auth application-default login` + required env vars. |
| `openrouter` | API key | Already. |
| `litellm` | API key + baseURL | Already via setup/custom model. |
| `openai-compatible` | API key + baseURL + custom models | Already via custom model wizard; integrate with /connect for the provider-level credential if desired. |
| `anthropic-compatible` (proposed) | API key + baseURL + custom models | Needed for models.dev-aligned presets like `minimax` and `kimi-for-coding` without pretending they’re Anthropic proper. |
| `glama` | API key | Already. |

---

## 9. Tasklist

### Phase 0 — Decisions + interface design
> **Goal:** settle storage/layout and define the internal shapes so CLI/WebUI/server can share a single source of truth.

- [ ] **0.1 Decide auth storage layout (breaking change)**
  - Deliverables:
    - Final on-disk layout for Dexto auth + LLM provider profiles (including permissions).
    - Confirm the breaking-change stance: **no backwards-compat support** for legacy `~/.dexto/auth.json` (require re-login to populate the new store).
  - Exit:
    - `USER_VERIFICATION.md` contains the resolved decision and any explicit follow-ups.

- [ ] **0.2 Decide provider identity + preset strategy (models.dev-driven)**
  - Deliverables:
    - Decide whether our user-facing provider IDs should align with **models.dev provider IDs** (example set: `moonshotai`, `moonshotai-cn`, `zai`, `zai-coding-plan`, `zhipuai`, `zhipuai-coding-plan`, `minimax`, `minimax-cn`, `kimi-for-coding`) vs remain “Dexto-local” (`glm`, `minimax`, etc.) with aliases.
    - Define “preset” behavior (the core abstraction for “more providers”):
      - which **transport** a preset uses (`openai-compatible` vs `anthropic-compatible` vs first-class SDK),
      - which baseURL variants exist (global/CN, coding-plan vs standard),
      - which env var names we display/accept (models.dev vs OpenClaw conventions, e.g. `ZHIPU_API_KEY` vs `ZAI_API_KEY`),
      - which default model(s) we surface.
    - Decide how models.dev provider metadata maps to connect UX (provider list, labels, baseURL hints, env var hints, curated defaults).
  - Exit:
    - Provider/method matrix updated and `USER_VERIFICATION.md` captures the choice.

- [ ] **0.3 Define provider auth method + profile types**
  - Deliverables:
    - `ProviderAuthMethod`, `ProviderAuthMethodKind`, `ProviderAuthResult`, `ProviderRuntimeAuth`.
    - `ProviderCredentialProfile` (stored credential material).
  - Exit:
    - Shared types are defined with no “shadow copies” (server + CLI consume the same types).

- [ ] **0.4 Decide resolution precedence + config surface**
  - Deliverables:
    - Final precedence rules for `llm.apiKey` / `llm.authProfileId` / defaults / env.
    - Decision whether we ship `llm.authProfileId` in v1.
    - Decision whether precedence is hardcoded vs configured in the profile store (e.g., OpenClaw-style ordered profiles: `~/Projects/external/openclaw/src/agents/auth-profiles/order.ts`).
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

### Phase 2 — Provider presets + “more providers” foundation (MiniMax / Z.AI / Moonshot / Kimi)
> **Goal:** make these providers connectable + runnable with minimal per-provider work, leveraging models.dev metadata and OpenAI-compatible presets where possible.

- [ ] **2.1 Add provider preset catalog (models.dev-seeded; baseURL + env + transport)**
  - Deliverables:
    - A single place that defines **provider presets** with fields like:
      - `modelsDevProviderId` (string, e.g. `moonshotai-cn`)
      - `transport` (e.g. `openai-compatible` vs `anthropic-compatible` vs first-class SDK)
      - `baseURL` (from models.dev `provider.api` when present, or curated override)
      - `envVars` (from models.dev `provider.env` + any Dexto aliases)
      - `docUrl` (from models.dev `provider.doc`, optional)
      - `defaultModel` + curated model list (optional)
    - Initial curated presets (at minimum):
      - **MiniMax**: `minimax`, `minimax-cn`, `minimax-coding-plan`, `minimax-cn-coding-plan` (Anthropic-compatible per models.dev; plus optional OpenAI-compatible variants if we keep them)
      - **Zhipu/GLM**: `zhipuai`, `zhipuai-coding-plan`
      - **Z.AI**: `zai`, `zai-coding-plan`
      - **Moonshot/Kimi**: `moonshotai`, `moonshotai-cn`
      - **Kimi Code**: `kimi-for-coding` (Anthropic-compatible per models.dev)
    - Each preset maps to one or more `/connect` methods (API key, OAuth, token), plus display labels + hints.
  - Exit:
    - `/connect` can show these providers/methods and persist profiles for API-key methods.

- [ ] **2.2 Implement chosen runtime strategy for new providers**
  - Deliverables (based on Phase 0.2 decision):
    - **If first-class providers:** extend `packages/core/src/llm/types.ts` (`LLM_PROVIDERS`), `packages/core/src/llm/services/factory.ts` (provider switch), and API-key env var mapping so the models.dev-aligned IDs (e.g. `moonshotai`, `zai`, `zhipuai`, `minimax-cn`, `kimi-for-coding`) can run without “custom model” hacks.
    - **If preset-based (recommended for breadth):**
      - ensure profiles carry `transport + baseURL + modelsDevProviderId` so runtime can choose the correct SDK surface:
        - OpenAI-compatible: `createOpenAI({ baseURL }).chat(...)`
        - Anthropic-compatible: `createAnthropic({ baseURL }).messages(...)` (or a dedicated `anthropic-compatible` driver if we don’t want to change `anthropic`)
      - ensure models.dev provider IDs still show up in UX even if runtime uses a shared driver (`openai-compatible`, `anthropic-compatible`).
  - Exit:
    - Manual smoke: connect + run at least one model for each preset ecosystem (MiniMax / Z.AI / Zhipu / Moonshot / Kimi Code).

- [ ] **2.3 Expand `/connect` provider list using models.dev**
  - Deliverables:
    - Provider picker uses models.dev **provider registry** for name + env vars + baseURL + model list, with a curated “top providers” grouping.
    - Providers without special methods still get a default “API key” method (and “custom baseURL” when applicable).
  - Exit:
    - `/connect` can add an API-key profile for a models.dev provider without adding per-provider code (where transport is already supported).

### Phase 3 — OpenAI ChatGPT OAuth (Codex)
> **Goal:** make OAuth a first-class method whose tokens affect runtime requests (not just storage).

- [ ] **3.1 Implement OpenAI OAuth authorize/callback flows + persistence**
  - Deliverables:
    - Dexto-owned OpenAI OAuth app config (client ID + allowed redirect URIs) and a safe place to store the client ID (non-secret) in-repo.
    - OAuth flow helper that supports local browser callback and headless/device-code paths.
    - Persist token + refresh metadata in the profile store.
    - Allowlist-aware error handling + UX (clear message + fallback to API key).
  - Exit:
    - Manual OAuth connect succeeds (for allowlisted accounts); token is stored; secrets are not logged.

- [ ] **3.2 Implement refresh token logic**
  - Deliverables:
    - Refresh on expiry with safe concurrent refresh behavior.
  - Exit:
    - Unit tests cover refresh success/failure and persistence updates.

- [ ] **3.3 Implement runtime wiring in `packages/core/src/llm/services/factory.ts`**
  - Deliverables:
    - Provider-specific runtime overrides for OpenAI OAuth (headers/fetch/baseURL/URL rewrite as needed).
  - Exit:
    - Regression tests cover request rewrite correctness (unit-level; network mocked).

### Phase 4 — MiniMax Portal OAuth (device-code/PKCE)
> **Goal:** add a second OAuth method (MiniMax) to validate the method registry + refresh patterns beyond OpenAI.

- [ ] **4.1 Implement MiniMax OAuth authorize/callback flows + persistence**
  - Deliverables:
    - Dexto-owned MiniMax OAuth app config (client ID + allowed redirect URIs) OR explicit confirmation that the public client ID we reference is intended for third-party clients.
    - Device-code/PKCE-style flow modeled after OpenClaw’s implementation:
      - `~/Projects/external/openclaw/extensions/minimax-portal-auth/oauth.ts`
      - `~/Projects/external/openclaw/extensions/minimax-portal-auth/index.ts`
    - Persist token + refresh metadata in the profile store.
  - Exit:
    - Manual MiniMax OAuth connect succeeds; token is stored; secrets are not logged.

- [ ] **4.2 Implement refresh token logic + runtime usage**
  - Exit:
    - Confirm the runtime auth material needed by MiniMax (bearer token vs derived API key) and implement refresh accordingly.

### Phase 5 — Anthropic setup-token (subscription) (if viable)
> **Goal:** add a second “non-api-key” method to validate the model.

- [ ] **5.1 Add `setup-token` method UX + storage**
  - Exit:
    - Token is stored as a profile and can be selected as default.

- [ ] **5.2 Validate runtime compatibility**
  - Exit:
    - Confirm compatibility with `@ai-sdk/anthropic`, or explicitly defer/remove this method for v1.

### Phase 6 — Bedrock + Vertex first-class connect UX
> **Goal:** make non-key providers feel “connectable” (guided setup) even if they use ADC/credential chains.

- [ ] **6.1 Add Bedrock connect UX (chain vs bearer token)**
  - Exit:
    - Clear UX for “store bearer token” and “use AWS credential chain” paths.

- [ ] **6.2 Add Vertex connect UX (ADC guidance)**
  - Exit:
    - UX clearly guides `gcloud auth application-default login` + required env vars.

### Phase 7 — WebUI parity
> **Goal:** WebUI reflects the same method-based auth model as the CLI.

- [ ] **7.1 Add “Connect provider” UI**
  - Exit:
    - WebUI can list providers, show methods, and connect at least API-key methods via server API.

- [ ] **7.2 Update “API keys” settings panel**
  - Exit:
    - WebUI shows connection status by method (not only “key exists”).

---

## 10. Security / UX Notes

- OAuth should support **headless** environments (device-code or “paste redirect URL” flows).
- Store secrets with `0o600` and avoid logging.
- If we keep localhost callback servers, ensure:
  - random `state` + verification (OpenCode does; our current Supabase flow has limitations).
  - short timeouts + clear cancellation paths.
- Prefer device-code where the upstream supports it (OpenCode’s headless ChatGPT method is a good template).

---

## 11. Open Questions (tracked for owner)

Owner-only questions and manual checks are tracked in `USER_VERIFICATION.md` (each item should map to a UV-* entry). Keep this section as a pointer, not a second source of truth.
