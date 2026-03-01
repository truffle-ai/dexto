---
name: "create-skill"
description: "Create a new standalone skill (SKILL.md) using creator-tools, including toolkits and allowed tools."
toolkits: ["creator-tools"]
allowed-tools: ["skill_create", "skill_update", "skill_search", "skill_list", "tool_catalog", "mcp_registry_catalog", "invoke_skill"]
---

# Create Skill

You help the user create a new standalone skill using the `skill_create` tool. Be **suggestive** and minimize back-and-forth. Prefer proposing defaults derived from the user’s description and ask for confirmation rather than asking multiple open-ended questions.

## Core Flow

1. **Infer defaults from the description**
   - Suggest a kebab-case `id` from the description.
   - Draft a one‑sentence `description` if missing.
   - Default `scope` to `workspace` unless the user requests global.
   - Default tool access to **no restrictions** unless the user explicitly needs tools. Only add `toolkits`/`allowed-tools` when required.

2. **Present a compact proposal**
   - Example: “I’ll create `id: create-automations` (workspace). Description: … Toolkits: … Allowed tools: … OK?”
   - Only ask targeted follow‑ups if there’s ambiguity (e.g., name collisions, missing intent, or explicit constraints).

3. **Avoid duplicates**
   - Use `skill_list` to discover standalone skills on disk.
   - If the user gave a name, also use `skill_search` to check loaded skills for conflicts.
   - If a conflict exists, ask whether to pick a new id or set `overwrite: true`.

4. **Build the skill content**
   - The tool expects `content` **without frontmatter**.
   - Include a clear title (`# ...`) and sections: **Purpose, Inputs, Steps, Output Format**.
   - Keep instructions actionable and concise.

5. **Create the skill**
   - Call `skill_create` with the collected fields.
   - Only use `overwrite: true` if the user explicitly approves it.

6. **Confirm success**
   - Report the returned path and scope.
   - Suggest next steps: update or test the skill using `invoke_skill`.

## Listing Toolkits

If the user asks which toolkits can be referenced:

1. Use `tool_catalog` and read `toolkitsAvailable` to enumerate toolkit factory types that can be referenced in skill frontmatter.
2. Use `tool_catalog` `tools` output to show currently runtime-available tool ids for this agent.
3. If the user needs deeper implementation details, check the agent image defaults and tools list. For the coding agent, inspect `packages/image-local/src/index.ts` and `agents/coding-agent/coding-agent.yml`.

## Listing Tools and MCP Servers

If the user asks which tools can be allowed in `allowedTools`:

1. Use `tool_catalog` to list available tool ids (includes currently loaded MCP tools with `mcp--` prefix).
2. Use `tool_catalog` `toolkitsAvailable` to suggest toolkits that can be loaded at invoke time even when tools are not currently loaded.
3. If needed, check the active agent config to see enabled tool factories. In this repo, the coding agent config is `agents/coding-agent/coding-agent.yml`.
4. If needed, list tool IDs directly from code using a ripgrep search, for example: `rg -n "id: '" packages/tools-* packages/tools-builtins`.
5. If you cannot confidently enumerate tool IDs, ask the user which tools they want to allow instead of guessing.

If the user asks which MCP servers can be used for a skill:

1. Use `mcp_registry_catalog` to discover MCP server presets (including non-connected ones).
2. Explain that registry entries can be referenced by id for skill design, while runtime invocation may still require credentials/config to connect successfully.

## Notes

- Use `skill_update` to modify an existing skill.
- Use `skill_search` to find loaded skills by name or description.
- Use `skill_list` to discover standalone skills on disk.

Start by proposing a sensible default configuration based on the user’s description, then confirm.
