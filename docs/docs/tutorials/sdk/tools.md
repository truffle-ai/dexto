---
sidebar_position: 5
title: "Adding Tools"
---

# Adding Tools

Your agent can chat, remember conversations, and serve multiple users. But ask it to "read a file" or "search the web," and it can't. LLMs only generate text—they don't interact with the world.

**Tools** change that. Tools let your agent read files, search the web, query databases, and more.

## The Problem

Without tools, your agent can't do much:

```typescript
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY }
});
await agent.start();

const session = await agent.createSession();
const response = await agent.generate(
  'Read package.json and tell me the version',
  session.id
);

console.log(response.content);
// "I cannot read files. You'll need to provide the contents..."
```

The agent knows it can't read files. It needs tools.

## Adding Your First Tool

Give your agent filesystem access:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY },
  mcpServers: {
    filesystem: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()]
    }
  }
});

await agent.start();
const session = await agent.createSession();

const response = await agent.generate(
  'Read package.json and tell me the version',
  session.id
);

console.log(response.content);
// "The version in package.json is 2.1.4"
```

**That's it.** Add `mcpServers` with a filesystem configuration, and your agent can now:
- Read files
- Write files
- List directories
- Search files
- Create directories

The agent automatically chooses when to use these tools.

## Adding Multiple Tools

Add more capabilities by adding more servers:

```typescript
const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY },
  mcpServers: {
    filesystem: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()]
    },
    web_search: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY }
    }
  }
});
```

Now ask it to do both:

```typescript
await agent.generate(
  'Search for TypeScript best practices and save a summary to tips.md',
  session.id
);
```

The agent will:
1. Search the web with Brave
2. Read the results
3. Write a summary to `tips.md`

All automatically.

## Popular MCP Servers

Here are common tools you can add:

### Filesystem
```typescript
filesystem: {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/directory']
}
```
Tools: `read_file`, `write_file`, `list_directory`, `search_files`

### Web Search (Brave)
```typescript
web_search: {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-brave-search'],
  env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY }
}
```
Tools: `brave_web_search`

### GitHub
```typescript
github: {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN }
}
```
Tools: `create_issue`, `search_code`, `get_file_contents`

### PostgreSQL
```typescript
postgres: {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-postgres'],
  env: { DATABASE_URL: process.env.DATABASE_URL }
}
```
Tools: `query`, `list_tables`, `describe_table`

Find more at [mcp.run](https://mcp.run) and [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers).

## How It Works

When you send a message, the agent:
1. Sees the available tools (from MCP servers)
2. Decides if it needs to use any tools
3. Calls the tools if needed
4. Uses the results to generate a response

You don't need to tell it when to use tools—it figures it out.

## What's Next?

Your agent now has real capabilities. But how do you show what it's doing in your UI? How do you display "Reading file..." or "Searching web..." to your users?

That's where events come in.

**Continue to:** [Handling Events](./events.md)
