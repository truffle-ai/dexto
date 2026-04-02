# MCP Server Pattern

Use this pattern when a skill needs to bundle a real MCP server in `scripts/`.

## Preferred Approach

- Use the official `@modelcontextprotocol/sdk` server APIs.
- Use `StdioServerTransport` for bundled local servers.
- Keep the MCP config in `mcps/*.json` simple and skill-relative:
  - `command`: usually `node`
  - `args`: usually `["scripts/<server-file>.mjs"]`
- Prefer `.mjs` for bundled MCP server scripts to avoid CommonJS/ESM ambiguity.

## Avoid

- Do not hand-roll MCP framing with manual `Content-Length` parsing unless the user explicitly asks for low-level protocol code.
- Do not claim the MCP works just because the script exists or passes `node --check`.
- Do not stop at writing `mcps/*.json` if the user asked for a real MCP implementation.

## Minimal Server Template

```js
#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
    {
        name: 'my-skill-server',
        version: '1.0.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'my_tool',
            description: 'Describe what the tool does.',
            inputSchema: {
                type: 'object',
                properties: {
                    value: {
                        type: 'string',
                    },
                },
                required: ['value'],
            },
        },
    ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'my_tool') {
        throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const value =
        typeof request.params.arguments?.value === 'string' ? request.params.arguments.value : '';

    return {
        content: [
            {
                type: 'text',
                text: `Handled: ${value}`,
            },
        ],
        structuredContent: {
            value,
        },
    };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

## Matching MCP Config

```json
{
  "mcpServers": {
    "my_server": {
      "type": "stdio",
      "command": "node",
      "args": ["scripts/my-skill-server.mjs"]
    }
  }
}
```

## Verification Sequence

1. Create or update `SKILL.md`, `scripts/`, and `mcps/`.
2. Run `skill_refresh` after non-creator file edits.
3. Invoke the skill in the current session.
4. Confirm the bundled MCP connects and the new MCP tool appears.
5. Call the MCP tool once with a simple input and confirm the result.

If step 3 or 4 fails, the skill is not done yet.
