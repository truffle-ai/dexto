<a href="https://dexto.ai">
  <div align="center">
    <picture>
      <source media="(prefers-color-scheme: light)" srcset=".github/assets/dexto_logo_light.svg">
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/dexto_logo_dark.svg">
      <img alt="Dexto" src=".github/assets/dexto_logo_dark.svg" width="80%" style="max-width: 1000px; padding: 24px;">
    </picture>
  </div>
</a>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Beta-yellow">
  <img src="https://img.shields.io/badge/License-Elastic%202.0-blue.svg">
  <a href="https://discord.gg/GFzWFAAZcm"><img src="https://img.shields.io/badge/Discord-Join%20Chat-7289da?logo=discord&logoColor=white"></a>
  <a href="https://deepwiki.com/truffle-ai/dexto"><img src="https://deepwiki.com/badge.svg"></a>
</p>

**An all-in-one toolkit for agentic AI applications.**

<div align="center">
  <img src="https://github.com/user-attachments/assets/89d30349-0cb1-4160-85db-d99a80a71d7a" alt="Dexto Demo" width="700" />
</div>

---

## What is Dexto?

Dexto is an **agent harness**—the orchestration layer that turns LLMs into reliable, stateful agents that can take actions, remember context, and recover from errors.

Think of it like an operating system for AI agents:

| Component | Analogy | Role |
|-----------|---------|------|
| **LLM** | CPU | Raw processing power |
| **Context Window** | RAM | Working memory |
| **Dexto** | Operating System | Orchestration, state, tools, recovery |
| **Your Agent** | Application | Domain-specific logic and clients |

### Why Dexto?

- **Configuration-driven**: Define agents in YAML. Swap models and tools without touching code.
- **Batteries included**: Session management, tool orchestration, memory, multimodal support, and observability—out of the box.
- **Run anywhere**: Local, cloud, or hybrid. CLI, Web UI, REST API, Discord, Telegram, or embedded in your app.

### What You Can Build

- **Autonomous Agents** – Plan, execute, and adapt to user goals
- **Digital Companions** – Assistants that remember context and anticipate needs
- **MCP Clients & Servers** – Connect tools, files, APIs via Model Context Protocol
- **Multi-Agent Systems** – Agents that collaborate, delegate, and solve complex tasks together
- **Agent-as-a-Service** – Transform APIs into conversational experiences

---

## Quick Start

### Install

```bash
# Install globally via npm
npm install -g dexto

# Or build from source
git clone https://github.com/truffle-ai/dexto.git
cd dexto && pnpm install && pnpm install-cli
```

### Run

```bash
# Start Dexto (launches setup wizard on first run)
dexto
```

**More options:**

```bash
dexto --mode cli                                   # Terminal mode
dexto -p "create a landing page for a coffee shop" # One-shot task
dexto --auto-approve "refactor this codebase"      # Skip confirmations
dexto --help                                       # Explore all options
dexto --mode mcp                                   # Expose agent as a tool (requires auto approvals)
```

### Manage Settings

```bash
# Configure defaults like LLM provider/model, API keys, or download local models
dexto setup
```

Logs are stored in `~/.dexto/logs/`. Use `DEXTO_LOG_LEVEL=debug` for verbose output.

---

## Core Features

### 50+ LLMs, Instant Switching

Switch models mid-conversation—no code changes, no restarts.

| Provider | Models |
|----------|--------|
| **OpenAI** | o3, o1, gpt-5.1, gpt-5-mini, gpt-4o |
| **Anthropic** | Claude Sonnet, Opus, Haiku (with extended thinking) |
| **Google** | Gemini 3 Pro, 2.5 Pro/Flash |
| **Groq** | Llama 4, Qwen, DeepSeek |
| **xAI** | Grok 4, Grok 3 |
| **Local** | Ollama, GGUF via node-llama-cpp (Llama, Qwen, Mistral, etc.) |
| **+ Gateways** | OpenRouter, AWS Bedrock, Vertex AI, LiteLLM |

**Run locally for privacy**: Local models keep data on your machine with automatic GPU detection (Metal, CUDA, Vulkan).

### MCP Integration (30+ Tools)

Connect to Model Context Protocol servers for filesystem, browser, database, and API access.

```yaml
# agents/my-agent.yml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
  browser:
    type: stdio
    command: npx
    args: ['-y', '@anthropics/mcp-server-puppeteer']
```

Browse and add servers from the MCP Store directly in the Web UI.

### Human-in-the-Loop Controls

Fine-grained control over what your agent can do:

```yaml
toolConfirmation:
  mode: manual           # Require approval for each tool
  # mode: auto-approve   # Trust mode for local iteration
  toolPolicies:
    - tool: bash_execute
      policy: always_confirm
    - tool: read_file
      policy: auto_approve
```

Agents remember which tools you've approved per session.

### Persistent Sessions & Memory

Conversations persist across restarts. Create memories that shape agent behavior.

```bash
# Continue last conversation
dexto -c

# Resume specific session
dexto -r session-abc123

# Search across all conversations
dexto search "database schema"
```

### Multi-Agent Systems

Coordinate multiple agents by exposing them as MCP servers:

```bash
# Triage agent routes to specialized agents via MCP
dexto --agent triage-agent
```

Each agent becomes a tool that other agents can invoke—no code coupling.

---

## Run Modes

| Mode | Command | Use Case |
|------|---------|----------|
| **Web UI** | `dexto` | Chat interface with file uploads (default) |
| **CLI** | `dexto --mode cli` | Terminal interaction |
| **Web Server** | `dexto --mode server` | REST & SSE APIs |
| **MCP Server** | `dexto --mode mcp` | Expose agent as an MCP server over stdio |

Platform integrations: [Discord](examples/discord-bot/), [Telegram](examples/telegram-bot/)

### Dexto as an MCP Server

#### Transport `stdio`

Use this when you want to connect your Dexto agent as an MCP server over stdio in Claude Code or Cursor (local tool-host workflows without an HTTP server).

```bash
# Start the default agent as an MCP server over stdio
dexto --mode mcp

# Run via npx
npx dexto --mode mcp

# Select a specific agent by ID
dexto --mode mcp --agent coding-agent

# Select a specific agent config file
dexto --mode mcp --agent ./agents/custom-agent.yml
```

Example MCP config entries for Claude Code or Cursor (stdio):

```json
{
  "command": "npx",
  "args": ["-y", "dexto", "--mode", "mcp", "--agent", "coding-agent"]
}
```

`mcp` mode runs without an interactive interface, so manual tool confirmation and elicitation cannot be used. Update your agent config before starting:

```yaml
toolConfirmation:
  mode: auto-approve  # or auto-deny if you want tool-level restrictions

elicitation:
  enabled: false
```

### Transport: `http/sse`


When you start `dexto --mode server`, the server exposes REST endpoints and also exposes your agent as an MCP server at `/mcp` (HTTP/SSE). Use this when you want remote MCP clients to interact to your agent over the network.
```bash
# Start the server (REST + MCP endpoint)
dexto --mode server --port 3001
```

Optionally, expose the MCP endpoint publicly with ngrok
```
ngrok http 3001
```

---

## Dexto Agents SDK

Build AI agents programmatically. Everything the CLI does, your code can too.

```bash
npm install @dexto/core
```

```typescript
import { DextoAgent } from '@dexto/core';

const agent = new DextoAgent({
  llm: { provider: 'openai', model: 'gpt-5-mini', apiKey: process.env.OPENAI_API_KEY }
});
await agent.start();

const session = await agent.createSession();
const response = await agent.generate('What is TypeScript?', session.id);
console.log(response.content);

// Streaming
for await (const event of await agent.stream('Write a story', session.id)) {
  if (event.name === 'llm:chunk') process.stdout.write(event.content);
}

// Multimodal
await agent.generate([
  { type: 'text', text: 'Describe this image' },
  { type: 'image', image: base64Data, mimeType: 'image/png' }
], session.id);

// Switch models mid-conversation
await agent.switchLLM({ model: 'claude-sonnet-4-5-20250929' });
```

**Start a server programmatically:**

Start a Dexto server programmatically to expose REST and SSE streaming APIs to interact and manage your agent backend.

```typescript
import { DextoAgent } from '@dexto/core';
import { startHonoApiServer } from 'dexto';

const agent = new DextoAgent(config);
const { server } = await startHonoApiServer(agent, 3001);
// POST /api/message, GET /api/sessions, etc.
```

This starts an HTTP server with full REST and SSE APIs, enabling integration with web frontends, webhooks, and other services. See the REST API Documentation for available endpoints.

---

## Agent Registry

Pre-built agents for common use cases:

```bash
# List available agents
dexto list-agents

# Install and run
dexto install coding-agent podcast-agent
dexto --agent coding-agent
```

**Available:** Coding, Podcast, Image Editor, Video (Sora), Database, GitHub, Triage (multi-agent), and more.

See the full [Agent Registry](https://docs.dexto.ai/docs/guides/agent-registry).

---

## Configuration

Define agents in version-controlled YAML:

```yaml
# agents/production-agent.yml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.']

systemPrompt: |
  You are a helpful assistant with filesystem access.

storage:
  cache:
    type: redis
    url: $REDIS_URL
  database:
    type: postgres
    connectionString: $POSTGRES_CONNECTION_STRING

toolConfirmation:
  mode: manual
```

See the [Configuration Guide](https://docs.dexto.ai/docs/category/agent-configuration-guide).

---

<details>
<summary><strong>Demos & Examples</strong></summary>

### Coding Agent
Build applications from natural language:
```bash
dexto --agent coding-agent
# "Create a snake game and open it in the browser"
```
<img src=".github/assets/coding_agent_demo.gif" alt="Coding Agent Demo" width="600"/>

### Podcast Agent
Generate multi-speaker audio content:
```bash
dexto --agent podcast-agent
```
<img src="https://github.com/user-attachments/assets/cfd59751-3daa-4ccd-97b2-1b2862c96af1" alt="Podcast Agent Demo" width="600"/>

### Computer Vision
Face detection and annotation:
```bash
dexto --agent image-editor-agent
```
<img src="https://github.com/user-attachments/assets/7e4b2043-c39a-47c7-a403-a9665ee762ce" alt="Face Detection Demo" width="600">

### Multi-Agent Triage
Coordinate specialized agents:
```bash
dexto --agent triage-agent
```
<img src=".github/assets/triage_agent_demo.gif" alt="Triage Agent Demo" width="600">

### MCP Store
Browse and add tools instantly:
<img src=".github/assets/mcp_store_demo.gif" alt="MCP Store Demo" width="600">

### Memory System
Persistent context that shapes behavior:
<img src=".github/assets/memory_demo.gif" alt="Memory Demo" width="600">

### Dynamic Forms
Agents generate forms for structured input:
<img src=".github/assets/user_form_demo.gif" alt="User Form Demo" width="600">

### Browser Automation
<a href="https://youtu.be/C-Z0aVbl4Ik">
  <img src="https://github.com/user-attachments/assets/3f5be5e2-7a55-4093-a071-8c52f1a83ba3" alt="Amazon Shopping Demo" width="600"/>
</a>

### MCP Playground
Test tools before deploying:
<img src=".github/assets/playground_demo.gif" alt="Playground Demo" width="600">

### Portable Agents (Cursor Integration)
<img src="https://github.com/user-attachments/assets/fd75a63f-4d29-447a-be24-6943e34c387f" alt="Cursor Integration" width="600">

</details>

---

<details>
<summary><strong>CLI Reference</strong></summary>

```
Usage: dexto [options] [command] [prompt...]

Basic Usage:
  dexto                    Start web UI (default)
  dexto "query"            Run one-shot query
  dexto --mode cli         Interactive CLI

Session Management:
  dexto -c                 Continue last conversation
  dexto -r <id>            Resume specific session

Options:
  -a, --agent <path>       Agent config file or ID
  -m, --model <model>      LLM model to use
  --auto-approve           Skip tool confirmations
  --mode <mode>            web | cli | server | mcp
  --port <port>            Server port

Commands:
  setup                    Configure global preferences
  install <agents...>      Install agents from registry
  list-agents              List available agents
  session list|history     Manage sessions
  search <query>           Search conversation history
```

Full reference: `dexto --help`

</details>

---

## Documentation

- **[Quick Start](https://docs.dexto.ai/docs/getting-started/intro/)** – Get running in minutes
- **[Configuration Guide](https://docs.dexto.ai/docs/category/guides/)** – Agents, LLMs, tools
- **[SDK Reference](https://docs.dexto.ai/api/sdk/dexto-agent)** – Programmatic usage
- **[REST API](https://docs.dexto.ai/api/rest/)** – HTTP endpoints

---

## Telemetry

Anonymous usage data helps improve Dexto. Opt out: `DEXTO_ANALYTICS_DISABLED=1`

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

---

## Community

Built by [Truffle AI](https://www.trytruffle.ai). Join [Discord](https://discord.gg/GFzWFAAZcm) for support.

If you find Dexto useful, please give us a ⭐ on GitHub—it helps a lot!

[![Twitter Follow](https://img.shields.io/twitter/follow/Rahul?style=social)](https://x.com/intent/user?screen_name=Road_Kill11)
[![Twitter Follow](https://img.shields.io/twitter/follow/Shaunak?style=social)](https://x.com/intent/user?screen_name=shaun5k_)

---

## Contributors

[![Contributors](https://contrib.rocks/image?repo=truffle-ai/dexto)](https://github.com/truffle-ai/dexto/graphs/contributors)

---

## License

Elastic License 2.0. See [LICENSE](LICENSE).
