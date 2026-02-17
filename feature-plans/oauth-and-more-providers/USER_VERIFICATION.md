# Owner Verification — OAuth + Multi-Method Provider Connect

> **This file tracks owner-only decisions and manual verifications that we defer while implementing.**
> Agents should keep it up to date throughout the work.

---

## How to use this file

1. **When a decision is deferred:** Add an item under “Open Items” with a short description and why it needs owner input.
2. **When a manual verification is required:** Add an item (e.g., “run OAuth E2E”, “confirm runtime request rewrite”, “choose between options A/B”).
3. **During implementation:** If you add a TODO that requires owner sign‑off, also add it here (so it doesn’t get lost).
4. **Before shipping:** Review this list and resolve/close everything, or explicitly defer items to a follow‑up plan.

---

## Open Items

| ID | Item | Why owner-only | Target phase | Status | Notes |
|----|------|----------------|--------------|--------|-------|
| UV-1 | Auth storage layout + migration | Affects backwards compatibility and security posture | 0.1 | Open | Decide whether to migrate `~/.dexto/auth.json` → `~/.dexto/auth/{dexto.json,llm-profiles.json}` vs extend the existing file vs alternate layout. |
| UV-2 | OpenAI Codex OAuth provider identity | Product/UX naming + config surface | 0.2 | Open | Decide `provider: openai + method=codex-oauth` vs a distinct provider ID (e.g., `openai-codex`). |
| UV-3 | `llm.authProfileId` in v1? | UX vs complexity tradeoff | 0.3 | Open | Decide whether per-agent pinning ships in v1 or defaults-per-provider only. |
| UV-4 | Where OAuth refresh logic lives | Architecture boundary decision | 2.2 | Open | Decide shared refresh helper vs per-provider method impl; core vs agent-management ownership. |
| UV-5 | Anthropic setup-token viability | Requires real-world validation + SDK behavior check | 3.2 | Open | If incompatible with `@ai-sdk/anthropic`, decide whether to drop this method for v1. |
| UV-6 | “More providers” scope for v1 | Product scope decision | 6.6 / Phase 1 | Open | Decide which providers become first-class in v1 vs steer to OpenRouter/LiteLLM/Dexto Nova. |
| UV-7 | Manual smoke: `/connect` UX | Requires local interactive runs | Phase 1+ | Open | Verify connect flow UX: create/switch default profiles, no secret leakage, file permissions are correct. |
| UV-8 | Manual smoke: OpenAI OAuth runtime behavior | Requires real OAuth account + network | Phase 2 | Open | Verify token refresh + request rewrite works end-to-end (including Responses API behavior). |
| UV-9 | Manual smoke: WebUI parity | Requires running WebUI | Phase 5 | Open | Verify WebUI reflects method-based auth and doesn’t regress existing API key settings. |

---

## Resolved Items

| ID | Decision / Verification | Date | Notes |
|----|--------------------------|------|-------|
| _TBD_ |  |  |  |
