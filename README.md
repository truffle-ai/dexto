# Dexto (formerly Saiki)

<p align="center">
  <img src="https://img.shields.io/badge/Status-Beta-yellow">
  <img src="https://img.shields.io/badge/License-Elastic%202.0-blue.svg">
  <a href="https://discord.gg/GFzWFAAZcm"><img src="https://img.shields.io/badge/Discord-Join%20Chat-7289da?logo=discord&logoColor=white"></a>
  <a href="https://deepwiki.com/truffle-ai/dexto"><img src="https://deepwiki.com/badge.svg"></a>
</p>

**A comprehensive toolkit to build agentic applications that turn natural language into real-world actions.**

<div align="center">
  <img src="https://github.com/user-attachments/assets/9a796427-ab97-4c8f-8ac2-09cf58135553" alt="Dexto Demo" width="700" />
</div>

## What is Dexto?

Dexto is a developer toolkit for building agentic applications—software that understands natural language and takes real-world actions. It offers a unified agent interface that combines LLMs, tools, and data into stateful, orchestrated systems with persistent memory. Dexto turns multimodal prompts (text, images, files) into intelligent workflows, assistants, and interactive experiences, enabling you to rapidly create context-aware apps that automate tasks and deliver value across diverse use cases.

### What You Can Build

- **Autonomous Agents** – Apps that plan, execute, and adapt to user goals.
- **Digital Companions** – Assistants that remember context and anticipate needs.
- **Multi-Agent Systems** – Architect teams of agents that collaborate, delegate, and solve complex tasks together.
- **MCP Client** – Unified interface to connect tools, files, APIs, and data.
- **Reasoning Engine** – Add decision-making and automation to any product or workflow.
- **Agentic Applications** – Build interactive, multimodal AI-native apps.

Dexto unifies a configuration-driven framework, robust runtime, and seamless developer experience—so you can build, deploy, and iterate with ease.

- **Framework** – Define agent behavior in YAML. Instantly swap models and tools without touching code.
- **Runtime** – Execution with session management, conversation memory, and multimodal support.
- **Interfaces & Tooling** – Native support for CLI, Web, APIs, and a TypeScript SDK. Develop, debug, and interact with your agent across any platforms from day one.

### What You Get

- **Batteries Included** – Session management, tool orchestration, multimodal support. *It just works.*
- **20+ LLMs** – Instantly switch between OpenAI, Anthropic, Google, Groq, local models or bring your own. *One config change.*
- **Run Anywhere** – Local for privacy, cloud for reach, or hybrid. *Same agent, any deployment.*
- **Native Multimodal** – Text, images, files, and tools in a single conversation. *Upload screenshots, ask questions, take actions.*
- **Smart Sessions** – Persistent conversations with context memory. *Close your browser, return days later, and pick up where you left off.*
- **Multi-Interface** – One agent, endless interfaces. *CLI, Web, Discord, Telegram, APIs.*
- **Production Ready** – Observability and error handling built-in. *Stay reliable under real-world conditions.*

---

## Installation

```bash
# NPM global
npm install -g dexto

# —or— build from source
git clone https://github.com/truffle-ai/dexto.git
cd dexto && npm i && npm run build && npm link
```

## Quick Start

```bash
# 1. Set your API key
export OPENAI_API_KEY=your_openai_api_key_here

# 2. Try a multi-step task
dexto "create a snake game in HTML/CSS/JS, then open it in the browser"

# Optional: Launch the Web UI
dexto --mode web
```

Dexto will use filesystem tools to write code and browser tools to open it—all from a single prompt. The Web UI allows you to navigate previous conversations and experiment with different models, tools and more.

## Examples & Demos

### 🛒 Amazon Shopping Assistant
**Task:** `Can you go to amazon and add some snacks to my cart? I like trail mix, cheetos and maybe surprise me with something else?`
```bash
# Default agent has browser tools
dexto
```
<a href="https://youtu.be/C-Z0aVbl4Ik">
  <img src="https://github.com/user-attachments/assets/3f5be5e2-7a55-4093-a071-8c52f1a83ba3" alt="Dexto: Amazon shopping agent demo" width="600"/>
</a>


### 📧 Send Email Summaries to Slack
**Task:** `Summarize emails and send highlights to Slack`
```bash
dexto --agent ./agents/examples/email_slack.yml
```
<img src="assets/email_slack_demo.gif" alt="Email to Slack Demo" width="600">

---

## Run Modes

| Mode | Command | Best for |
|------|---------|----------|
| **Interactive CLI** | `dexto` | Everyday automation & quick tasks |
| **Web UI** | `dexto --mode web` | Friendly chat interface w/ image support |
| **Headless Server** | `dexto --mode server` | REST & WebSocket APIs for agent interaction |
| **MCP Server (Agent)** | `dexto --mode mcp` | Exposing your agent as a tool for others via stdio |
| **MCP Server (Aggregator)** | `dexto mcp --group-servers` | Re-exposing tools from multiple MCP servers via stdio |
| **Discord Bot** | `dexto --mode discord` | Community servers & channels ([Requires Setup](src/app/discord/README.md)) |
| **Telegram Bot** | `dexto --mode telegram` | Mobile chat ([Requires Setup](src/app/telegram/README.md)) |

Run `dexto --help` for **all flags, sub-commands, and environment variables**.

## Configuration

### Agent Configuration

Dexto treats each configuration as a unique agent allowing you to define and save combinations of LLMs, servers, storage options, etc. based on your needs for easy portability. Define agents in version-controlled YAML. Change the file, reload, and chat—state, memory, and tools update automatically.

```yaml
# agents/my-agent.yml
llm:
  provider: openai
  model: gpt-4o
  apiKey: $OPENAI_API_KEY

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
  web:
    type: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-brave-search']

systemPrompt: |
  You are a helpful AI assistant with access to files and web search.
```

### LLM Providers

Switch between providers instantly—no code changes required.

| Provider | Models | Setup |
|----------|--------|-------|
| **OpenAI** | `gpt-4o`, `gpt-4o-mini`, `gpt-5` | `export OPENAI_API_KEY=...` |
| **Anthropic** | `claude-3.5-sonnet`, `claude-3-opus` | `export ANTHROPIC_API_KEY=...` |
| **Google** | `gemini-2.0-flash`, `gemini-1.5-pro` | `export GOOGLE_GENERATIVE_AI_API_KEY=...` |
| **Groq** | `llama-3.3-70b`, `gemma-2-9b` | `export GROQ_API_KEY=...` |

```bash
# Switch models via CLI
dexto -m claude-3.5-sonnet-20240620
dexto -m gemini-1.5-flash-latest
```

See our [Configuration Guide](https://docs.dexto.ai/category/dexto-configuration-guide) for complete setup instructions.

## Agent Recipes

Dexto comes with pre-built agent recipes for common use cases. Install and use them instantly:

```bash
# List available agents
dexto list-agents

# Install specific agents
dexto install database-agent music-agent

# Use an agent
dexto --agent database-agent "show me all users in the database"
dexto --agent music-agent "create a jazz melody in C major"
```

**Available Agents:**
- **Database Agent** – Demo agent for SQL queries and database operations
- **Image Editor Agent** – Image editing and manipulation  
- **Music Agent** – Music creation and audio processing
- **PDF Agent** – Document analysis and conversation
- **Product Researcher** – Product naming and branding research
- **Triage Agent** – Demo multi-agent customer support routing system

Each agent is pre-configured with the right tools, prompts, and LLM settings for its domain. No setup required—just install and start building.

More ready-to-run recipes live in [`agents/`](agents/) and the [docs site](https://docs.dexto.ai/).


## Programmatic API

Build applications with the `DextoAgent` class. Everything the CLI can do, your code can too.

```ts
import { DextoAgent } from 'dexto';

// Create and start agent
const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: process.env.OPENAI_API_KEY
  }
});
await agent.start();

// Run tasks
const response = await agent.run('List the 5 largest files in this repo');
console.log(response);

// Hold conversations
await agent.run('Write a haiku about TypeScript');
await agent.run('Make it funnier');

await agent.stop();
```

See our [TypeScript SDK docs](https://docs.dexto.ai/api/category/typescript-sdk) for complete examples with MCP tools, sessions, and advanced features.

---

## Advanced Usage

### Session Management

Create and manage multiple conversation sessions with persistent storage.

```typescript
const agent = new DextoAgent(config);
await agent.start();

// Create and manage sessions
const session = await agent.createSession('user-123');
await agent.run('Hello, how can you help me?', undefined, 'user-123');

// List and manage sessions
const sessions = await agent.listSessions();
const sessionHistory = await agent.getSessionHistory('user-123');
await agent.deleteSession('user-123');

// Search across conversations
const results = await agent.searchMessages('bug fix', { limit: 10 });
```

### LLM Management

Switch between models and providers dynamically.

```typescript
// Get current configuration
const currentLLM = agent.getCurrentLLMConfig();

// Switch models (provider inferred automatically)
await agent.switchLLM({ model: 'gpt-4o' });
await agent.switchLLM({ model: 'claude-3.5-sonnet' });

// Get supported providers and models
const providers = agent.getSupportedProviders();
const models = agent.getSupportedModels();
const openaiModels = agent.getSupportedModelsForProvider('openai');
```

### MCP Manager

For advanced MCP server management, use the MCPManager directly.

```typescript
import { MCPManager } from 'dexto';

const manager = new MCPManager();

// Connect to MCP servers
await manager.connectServer('filesystem', {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
});

// Access tools, prompts, and resources
const tools = await manager.getAllTools();
const prompts = await manager.getAllPrompts();
const resources = await manager.getAllResources();

// Execute tools
const result = await manager.executeTool('readFile', { path: './README.md' });

await manager.disconnectAll();
```

### Storage & Persistence

Configure storage backends for production-ready persistence and caching.

```yaml
# agents/production-agent.yml
storage:
  cache:
    type: redis
    url: $REDIS_URL
    maxConnections: 100
  database:
    type: postgres
    connectionString: $POSTGRES_CONNECTION_STRING
    maxConnections: 25

sessions:
  maxSessions: 1000
  sessionTTL: 86400000 # 24 hours
```

**Supported Backends:**
- **Cache**: Redis, In-Memory (fast, ephemeral)
- **Database**: PostgreSQL, SQLite, In-Memory (persistent, reliable)

**Use Cases:**
- **Development**: In-memory for quick testing
- **Production**: Redis + PostgreSQL for scale
- **Simple**: SQLite for single-instance persistence

See the [DextoAgent API Documentation](https://docs.dexto.ai/api/dexto-agent) for complete method references.

## Project Scaffolding

Create new Dexto projects or integrate into existing applications.

```bash
# Create a new Dexto project
dexto create-app my-ai-agent

# Initialize Dexto in existing TypeScript project
dexto init-app
```

**What you get:**
- Pre-configured agent setup
- TypeScript SDK integration
- Example configurations
- Development tooling

---

## CLI Reference

<details>
<summary>Click to expand for full CLI reference (`dexto --help`)</summary>

```
Usage: dexto [options] [command] [prompt...]

Dexto CLI allows you to talk to Dexto, build custom AI Agents, build complex AI applications like Cursor, and more.

Run dexto interactive CLI with `dexto` or run a one-shot prompt with `dexto -p "<prompt>"` or `dexto "<prompt>"`
Start with a new session using `dexto --new-session [sessionId]`
Run dexto web UI with `dexto --mode web`
Run dexto as a server (REST APIs + WebSockets) with `dexto --mode server`
Run dexto as a discord bot with `dexto --mode discord`
Run dexto as a telegram bot with `dexto --mode telegram`
Run dexto agent as an MCP server with `dexto --mode mcp`
Run dexto as an MCP server aggregator with `dexto mcp --group-servers`

Check subcommands for more features. Check https://github.com/truffle-ai/dexto for documentation on how to customize dexto and other examples

Arguments:
  prompt                           Natural-language prompt to run once. If not passed, dexto will start as an interactive CLI

Options:
  -v, --version                    output the current version
  -a, --agent <name|path>          Agent name or path to agent config file
  -p, --prompt <text>              One-shot prompt text. Alternatively provide a single quoted string as positional argument.
  -s, --strict                     Require all server connections to succeed
  --no-verbose                     Disable verbose output
  --no-interactive                 Disable interactive prompts and API key setup
  -m, --model <model>              Specify the LLM model to use
  -r, --router <router>            Specify the LLM router to use (vercel or in-built)
  --new-session [sessionId]        Start with a new session (optionally specify session ID)
  --mode <mode>                    The application in which dexto should talk to you - cli | web | server | discord | telegram | mcp (default: "cli")
  --web-port <port>                optional port for the web UI (default: "3000")
  --no-auto-install                Disable automatic installation of missing agents from registry
  -h, --help                       display help for command

Commands:
  create-app                       Scaffold a new Dexto Typescript app
  init-app                         Initialize an existing Typescript app with Dexto
  setup [options]                  Configure global Dexto preferences
  install [options] [agents...]    Install agents from the registry
  uninstall [options] [agents...]  Uninstall agents from the local installation
  list-agents [options]            List available and installed agents
  which <agent>                    Show the path to an agent
  mcp [options]                    Start Dexto as an MCP server. Use --group-servers to aggregate and re-expose tools from configured MCP servers.
```
</details>

---

## Next Steps

* **[Quick Start](https://docs.dexto.ai/getting-started/intro)** – Get up and running in minutes.
* **[Configuration Guide](https://docs.dexto.ai/category/guides)** – Configure agents, LLMs, and tools.
* **[Building with Dexto](https://docs.dexto.ai/category/tutorials)** – Developer guides and patterns.
* **[API Reference](https://docs.dexto.ai/api)** – REST APIs, WebSocket, and SDKs.

---

## Contributing

We welcome contributions! Refer to our [Contributing Guide](./CONTRIBUTING.md) for more details.

## Community & Support

Dexto is built by the team at [Truffle AI](https://www.trytruffle.ai).  
Join our Discord to share projects, ask questions, or just say hi!

[![Discord](https://img.shields.io/badge/Discord-Join%20Chat-7289da?logo=discord&logoColor=white)](https://discord.gg/GFzWFAAZcm)

If you enjoy Dexto, please give us a ⭐ on GitHub—it helps a lot!

 <div align="left"/>

[![Twitter Follow](https://img.shields.io/twitter/follow/Rahul?style=social)](https://x.com/intent/user?screen_name=Road_Kill11)
[![Twitter Follow](https://img.shields.io/twitter/follow/Shaunak?style=social)](https://x.com/intent/user?screen_name=shaun5k_)

</div>

---

## Contributors

Thanks to all these amazing people for contributing to Dexto!

[![Contributors](https://contrib.rocks/image?repo=truffle-ai/dexto)](https://github.com/truffle-ai/dexto/graphs/contributors)

---

## License

Elastic License 2.0.  See [LICENSE](LICENSE) for full terms.