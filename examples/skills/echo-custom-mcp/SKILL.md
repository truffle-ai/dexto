---
description: Use the bundled echo MCP tool for quick MCP connectivity checks.
---

# Echo Custom MCP

Use this skill when you need to verify that a skill bundle can bring along its own MCP server.

Workflow:
1. Invoke the bundled echo MCP tool with the message you want to test.
2. Return the echoed response to confirm the MCP connected successfully.

The bundled MCP config for this skill lives in `mcps/` and the server implementation lives in `scripts/`.
