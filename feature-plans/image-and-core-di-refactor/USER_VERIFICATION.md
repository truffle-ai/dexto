# Owner Verification — DI Refactor

> **This file tracks owner-only decisions and manual verifications that we defer while implementing.**
> Agents should keep it up to date throughout the refactor.

---

## How to use this file

1. **When a decision is deferred:** Add an item under “Open Items” with a short description and the reason it needs owner input.
2. **When a manual verification is required:** Add an item (e.g., “run manual smoke test”, “confirm API behavior”, “choose between options A/B”).
3. **During implementation:** If you add a TODO in code/docs that requires owner sign‑off, also add it here (so it doesn’t get lost).
4. **Before Phase 6 (platform):** Review this list and resolve/close everything, or explicitly defer items to a follow‑up plan.

---

## Open Items

| ID | Item | Why owner-only | Target phase | Status | Notes |
|----|------|----------------|--------------|--------|-------|
| UV-2 | CLI smoke (prompt/chat) | Requires local env + API keys | 4.5 | Open | Run `dexto -p "hello"` and verify tool execution + logs. |
| UV-3 | CLI server mode smoke | Requires ports/networking | 4.2 / 4.5 | Open | Run `dexto serve` and verify agent switching + endpoints. |
| UV-4 | Image store lifecycle | Requires real filesystem/home dir | 7.x | Open | `dexto image install/list/use/remove/doctor` behaves as expected. |
| UV-5 | Custom image E2E (create-image → build → install → run) | Requires spawning a new project + build | 3.6 + 7.x | Open | Verify `dexto create-image` output bundles correctly and is usable via the store. |
| UV-6 | WebUI/browser safety check | Requires manual WebUI run/build | 3.2 / 4.x | Open | Ensure schema-only imports don’t pull Node storage impls into WebUI. |
| UV-7 | Tool approval semantics (interactive) | Requires interactive approval UX | 5.1 / 4.5 | Open | Verify approval prompts + `--auto-approve` behavior with filesystem/process tools. |

### Verification details (suggested)

#### UV-2 — CLI smoke (prompt/chat)
- Run a minimal prompt flow: `dexto -p "Say hi and then list available tools."`
- Run an agent path flow: `dexto -a agents/coding-agent/coding-agent.yml --mode cli`
- Confirm:
  - agent starts without warnings/errors
  - tools are available and execute successfully
  - session logs are written (if configured)

#### UV-3 — CLI server mode smoke
- Start server mode: `dexto serve`
- Confirm:
  - health endpoints respond
  - agent switching works (switch by id/path) and uses the same image resolution behavior as CLI startup
  - server logs do not show image import failures

#### UV-4 — Image store lifecycle
- Validate basic commands:
  - `dexto image doctor`
  - `dexto image list` (empty + non-empty states)
  - `dexto image install <image>` (then `list`)
  - `dexto image use <image@version>` (when multiple installed versions exist)
  - `dexto image remove <image>` and `dexto image remove <image@version>`
- Confirm:
  - registry file is written at `~/.dexto/images/registry.json`
  - installed packages land under `~/.dexto/images/packages/...`
  - importing an uninstalled image produces the actionable error suggesting `dexto image install ...`

#### UV-5 — Custom image E2E
- Create a custom image **outside the monorepo** (so the scaffold uses published semver deps, not `workspace:*`):
  - `cd /tmp && dexto create-image my-test-image`
  - `cd my-test-image && pnpm run build` (or whatever PM the scaffold chose)
- Install into the store and run it:
  - `dexto image install .`
  - Set an agent YAML `image: '<your-package-name>'` (or use `--image`)
  - Run: `dexto -p "hello" --agent <path>` and confirm the image imports from the store.

#### UV-6 — WebUI/browser safety
- Open the Agent Editor and ensure the Storage section loads without bundling Node-only storage impls.
- Confirm WebUI uses `@dexto/storage/schemas` subpath where needed and builds cleanly.

#### UV-7 — Tool approval semantics
- Run a filesystem tool that should trigger approval and confirm UX matches expectations.
- Verify `--auto-approve` and non-interactive mode do not regress tool execution behavior.

---

## Resolved Items

| ID | Decision / Verification | Date | Notes |
|----|--------------------------|------|-------|
| UV-1 | Remove `ImageTarget` / `ImageConstraint` types | 2026-02-11 | No runtime usage; keep `metadata.target`/`metadata.constraints` as plain `string`/`string[]` fields. |
