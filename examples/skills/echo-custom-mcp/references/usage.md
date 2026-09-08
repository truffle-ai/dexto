# Echo Skill Usage

This sample bundle demonstrates the intended portable layout:

- `SKILL.md` contains the instructions the agent loads through `skill_load`
- `references/` contains optional background material loaded with `skill_load` and its `path`
- `scripts/` contains executable helpers that can be inspected or run explicitly
- `mcps/` contains inert MCP-related example files

Skills do not register or connect MCP servers from bundled files. Configure runtime MCP servers through normal MCP configuration paths.
