---
name: "create-skill"
description: "Create or update Dexto skill bundles with SKILL.md, handlers, scripts, mcps, and references."
toolkits: ["creator-tools"]
allowed-tools: ["skill_create", "skill_update", "skill_refresh", "skill_search", "skill_list", "tool_catalog", "invoke_skill"]
---

# Create Skill

Create or update standalone Dexto skill bundles. Treat `skills/<id>/` as the canonical workspace location unless the user explicitly asks for a global skill.

## Core Flow

1. Search for overlap first.
   - Use `skill_list` to inspect standalone skills on disk.
   - Use `skill_search` to inspect loaded skills that may already cover the request.

2. Propose the minimum viable skill shape.
   - Suggest a kebab-case `id`.
   - Draft a one-sentence `description`.
   - Default `scope` to `workspace`.
   - Default to no extra `toolkits` and no `allowed-tools` unless the workflow requires them.

3. Create or update the skill bundle.
   - Use `skill_create` for new skills and `skill_update` for existing ones.
   - The creator tools now scaffold `handlers/`, `scripts/`, `mcps/`, and `references/` automatically.
   - Treat `content` as the markdown body below the generated title and frontmatter. Do not include your own `# <Title>` line.
   - If you edit `SKILL.md` or bundled files with non-creator tools, run `skill_refresh` before you rely on the skill in the current session.

4. Keep `SKILL.md` lean.
   - Focus on trigger conditions, workflow, bundled resource navigation, and output expectations.
   - Keep most actionable instructions directly in `SKILL.md` so the agent can act without opening extra files.
   - Use `references/` sparingly for large copied docs, schemas, examples, policies, or linked external material.

5. Add bundled files only when they materially improve the workflow.
   - `references/`: large docs, copied external references, schemas, examples, or policies that would bloat `SKILL.md`
   - `scripts/`: deterministic helpers
   - `handlers/`: reusable workflow logic or helper code
   - `mcps/`: MCP configs the skill should carry with it
   - When a skill needs a real bundled MCP server, prefer the SDK-based stdio pattern in `references/mcp-server-pattern.md`.

6. Reuse before duplicating.
   - Extend nearby skills or references when the problem is already mostly solved.
   - If borrowing a pattern from another skill, adapt it instead of copying large blocks blindly.

7. Be precise about MCP status.
   - Creating `mcps/*.json` only creates bundled MCP config.
   - Do not say you created a real MCP server unless the config points at a bundled runnable implementation or a verified external command/package.
   - If the user asked for a real MCP and you only scaffolded config, say that clearly and keep going until the server exists or the user redirects you.
   - For real bundled MCPs, prefer the official `@modelcontextprotocol/sdk` server APIs with `StdioServerTransport`. Avoid hand-rolled Content-Length framing unless the user explicitly asks for low-level protocol code.

## SKILL.md Structure

- `## Purpose`
- `## When To Use`
- `## Workflow`
- `## Bundled Resources`
- `## Output Format`

## Notes

- Read `references/skill-anatomy.md` when you need the bundle layout or packaging checklist.
- Read `references/mcp-server-pattern.md` when the skill needs a bundled MCP server implementation.
- If you add MCP config files under `mcps/`, use `skill_refresh` after the edit so the running session reloads the skill metadata. Invoke the skill afterward to connect its bundled MCP servers.
- If the user asked for a working MCP-backed skill, prefer end-to-end verification by invoking the skill in the current session after `skill_refresh`.
- If the user asks which tools can be referenced, use `tool_catalog`.
