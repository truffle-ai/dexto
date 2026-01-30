---
'@dexto/agent-management': patch
'@dexto/core': patch
'dexto': patch
---

Fix command discovery, update skills permissions, and rewrite AGENTS.md

**AGENTS.md:**
- Fix outdated stack info: WebUI is Vite + TanStack Router/Query (not Next.js)
- Fix API layer location: Hono routes in packages/server (not packages/cli/src/api)
- Add Stack Rules section (WebUI/Server/Core constraints)
- Add Avoiding Duplication section (search before adding utilities)
- Update Zod conventions: z.input/z.output instead of z.infer
- Remove verbose code examples and outdated architecture diagrams

**Slash commands/skills:**
- Restore .claude/commands/ and .cursor/commands/ discovery paths
- Change `allowed-tools` to additive semantics (auto-approve listed tools, don't block others)
- Reset session auto-approve tools on `run:complete` event
- Add tests for command discovery and permissions

**Other:**
- Skip changeset requirement for Dependabot PRs
