# Echo Custom MCP

This sample bundle demonstrates the intended portable layout:

- `SKILL.md` contains the instructions the agent loads through `invoke_skill`
- `mcps/*.json` carries MCP server definitions for the skill
- `scripts/` contains executable helpers used by the bundled MCP config

The MCP config intentionally references `scripts/echo-mcp-server.mjs` with a skill-relative path so Dexto can resolve it from the bundle root.
