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
| UV-1 | Auth storage layout (new `~/.dexto/auth/`) | Security posture + UX permanence | 0.1 | Open | Confirm final on-disk layout + permissions + atomic write strategy for `dexto.json` + `llm-profiles.json`. |
| UV-2 | OAuth app credentials + allowlisting (OpenAI Codex) | Requires external app registration + product comms | 3.1 | Open | We need Dexto-owned OpenAI OAuth client ID + registered redirect URIs; Codex OAuth may require allowlisting. Decide how we message failure + fallback to API key. |
| UV-3 | OAuth app credentials (MiniMax Portal) | Requires external app registration or explicit provider confirmation | 4.1 | Open | OpenClaw hardcodes a client ID; confirm whether we must register our own, or whether a public client ID is intended for third-party use. |
| UV-4 | Provider identity strategy (models.dev vs Dexto IDs) | Product naming + config compatibility | 0.2 | Open | Decide whether to align user-facing IDs with models.dev (`moonshotai`, `zhipuai`, `zai`, `minimax-cn`, `kimi-for-coding`, …) vs keep Dexto-local IDs (`glm`, `minimax`) with aliases. |
| UV-5 | Env var mapping for Z.AI / GLM | User expectation + migration risk | 0.2 | Open | models.dev uses `ZHIPU_API_KEY` for `zai`; OpenClaw uses `ZAI_API_KEY` / `Z_AI_API_KEY`. Decide which to accept and which to display as the “primary” hint. |
| UV-6 | MiniMax transport defaults (OpenAI-compatible vs Anthropic-compatible) | Impacts runtime correctness + preset design | 2.2 | Open | Dexto today assumes OpenAI-compatible (`api.minimax.chat`), while models.dev indicates Anthropic-compatible (`api.minimax.io/anthropic/v1`). Decide default + how we expose variants. |
| UV-7 | Models.dev provider metadata ingestion strategy | Impacts offline behavior + maintenance | 2.3 | Open | Decide whether we snapshot provider metadata at build-time (generated file) vs fetch+cache at runtime for `/connect` provider list + presets. |
| UV-8 | Resolution precedence surface | UX + “magic” risk | 0.4 | Open | Decide hardcoded precedence vs store-driven order; decide whether precedence lives in `llm-profiles` vs agent config; decide `llm.authProfileId` in v1. |
| UV-9 | Anthropic setup-token viability + ship criteria | External dependency + potential policy constraints | 5.2 | Open | Implement until infeasible; decide whether this is “experimental” and how we disable quickly if it breaks/gets blocked. |
| UV-10 | Manual smoke: `/connect` UX | Requires local interactive runs | Phase 1+ | Open | Verify connect flow UX: create/switch default profiles, no secret leakage, file permissions are correct. |
| UV-11 | Manual smoke: OpenAI OAuth runtime behavior | Requires real OAuth account + network | Phase 3 | Open | Verify token refresh + request rewrite works end-to-end (including Responses API behavior). |
| UV-12 | Manual smoke: WebUI parity | Requires running WebUI | Phase 7 | Open | Verify WebUI reflects method-based auth and doesn’t regress existing API key settings. |

---

## Resolved Items

| ID | Decision / Verification | Date | Notes |
|----|--------------------------|------|-------|
| UV-0 | No backwards compatibility with legacy `~/.dexto/auth.json` | 2026-02-17 | Require re-login to populate the new auth store; optional one-time import is not required for v1. |
