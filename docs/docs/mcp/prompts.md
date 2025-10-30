---
sidebar_position: 3
---

# MCP Prompts

## What are Prompts?

Prompts in the Model Context Protocol are pre-built, reusable templates that MCP servers expose to help users interact with LLMs. They provide structured starting points for common tasks.

**Specification:** [MCP Prompts Spec](https://spec.modelcontextprotocol.io/specification/2025-03-26/server/prompts/)

## How It Works

Servers can expose templated prompts with:
- A descriptive name and purpose
- Optional arguments for customization
- Pre-configured messages for the LLM

When you use a prompt, the server fills in the template and sends the formatted message to your LLM.

## Configuration

Prompts are discovered automatically from MCP servers:

```yaml
mcpServers:
  code-helper:
    type: stdio
    command: npx
    args: ["-y", "my-code-mcp-server"]
```

If the server supports prompts, they'll be available immediately.

## Using Prompts

### In Web UI

Type `/` to discover and invoke prompts from connected MCP servers.

### In CLI

List available prompts:
```bash
dexto
> /prompts
```

Use a prompt:
```bash
> /use code-review file=src/app.ts
```

Or use the shorthand (if supported):
```bash
> /code-review src/app.ts
```

### Via SDK

```typescript
// List prompts from a server
const client = agent.mcpManager.getClient('code-helper');
const prompts = await client.listPrompts();

// Get and execute a prompt
const prompt = await client.getPrompt('code-review', { file: 'app.ts' });
const response = await agent.sendMessage(prompt.messages);
```

## Prompt Structure

Prompts can include:
- **Text content** - Instructions and context
- **Images** - Visual references (base64-encoded)
- **Resources** - Embedded file contents from the server

Arguments can be:
- **Required** - Must be provided by the user
- **Optional** - Have default values
- **Auto-completable** - Server suggests valid values

## See Also

- [MCP Resources](./resources) - Data sources for context
- [MCP Overview](./overview) - Introduction to MCP
- [CLI Guide](../guides/cli/overview) - All CLI commands
