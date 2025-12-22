<a href="https://dexto.ai">
  <img src="https://raw.githubusercontent.com/truffle-ai/dexto/main/.github/assets/dexto-logo.svg" alt="Dexto" width="100%" style="max-width: 1000px" />
</a>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Beta-yellow">
  <img src="https://img.shields.io/badge/License-Elastic%202.0-blue.svg">
  <a href="https://discord.gg/GFzWFAAZcm"><img src="https://img.shields.io/badge/Discord-Join%20Chat-7289da?logo=discord&logoColor=white"></a>
  <a href="https://deepwiki.com/truffle-ai/dexto"><img src="https://deepwiki.com/badge.svg"></a>
</p>

**An all-in-one toolkit to build agentic applications that turn natural language into real-world actions.**

<div align="center">
  <img src="https://github.com/user-attachments/assets/89d30349-0cb1-4160-85db-d99a80a71d7a" alt="Dexto Demo" width="700" />
</div>

## What is Dexto?

Dexto is a universal intelligence layer for building collaborative, context-aware AI Agents & agentic apps. It orchestrates LLMs, tools, and data into persistent, stateful systems with memory, so you can rapidly create AI assistants, digital companions & copilots that think, act and feel alive.

Dexto combines a configuration-driven framework, robust runtime, and seamless developer experience so you can build, deploy, and iterate on your agents easily.

- **Framework** – Define agent behavior in YAML. Instantly swap models and tools without touching code.
- **Runtime** – Execution with orchestration, session management, conversation memory, and multimodal support.
- **Interfaces & Tooling** – Native support for CLI, Web, APIs, and the Dexto Agent SDK.

#### With Dexto, you can build:

- **Autonomous Agents**  - Agents that plan, execute, and adapt to user goals.
- **Digital Companions** - AI assistants & copilots that remember context and anticipate needs.
- **MCP Clients** - Connect multiple tools, files, APIs, and data via MCP Servers.
- **MCP Servers** - Dexto Web UI and MCP playground help you to easily test your own MCP servers.
- **Multi-Agent Systems**  - Architect agents that collaborate, delegate, and solve complex tasks together.
- **Agent-as-a-Service** – Transform your existing SaaS products and APIs into dynamic, conversational experiences.
- **Agentic Applications** – Integrate Dexto as a reasoning engine to power interactive, multimodal, AI-native applications.

#### What You Get

- **Batteries Included** – Session management, tool orchestration, multimodal support, and production-ready observability.
- **50+ LLMs** – Instantly switch between OpenAI, Anthropic, Google, Groq, local models or bring your own.
- **Run Anywhere** – Local for privacy, cloud for reach, or hybrid. *Same agent, any deployment.*
- **Native Multimodal** – Text, images, files, and tools in a single conversation. *Upload screenshots, ask questions, take actions.*
- **Persistent Sessions** – Conversations, context, and memory are saved and can be exported, imported, or shared across environments.
- **Flexible Interfaces** – One agent, endless ways to interact: Ready-to-use CLI, WebUI, APIs, or integrate with your own UI.
- **30+ Tools & MCP** – Integrate tools and connect to external servers via the Model Context Protocol (MCP) or use our internal tools.
- **Pluggable Storage** – Use Redis, PostgreSQL, SQLite, in-memory, S3 and more for cache, database & blob backends.
- **Human in the loop** - Configure approval policies for tool execution, agents can also remember which tools are safe per session. 
- **Observability** – Built-in OpenTelemetry distributed tracing, token usage monitoring, and error handling.

---

## Installation

```bash
# NPM global
npm install -g dexto

# —or— build from source
# this sets up dexto CLI from the cloned code
git clone https://github.com/truffle-ai/dexto.git
cd dexto && pnpm install && pnpm install-cli

```

## Quick Start

```bash
# 1. Run setup workflow - this prompts for your preferred LLM and API keys and opens the Web UI
dexto

# 2. Try a multi-step task in the web UI:
"create a snake game in HTML/CSS/JS, then open it in the browser"

# 3. Start interactive CLI mode instead of web UI
dexto --mode cli
```

In 2 -> Dexto will use filesystem tools to write code and browser tools to open it — all from a single prompt. The Web UI (default mode) allows you to navigate previous conversations and experiment with different models, tools and more. 

The interactive CLI (3) allows you to interact with agents in the terminal.

See the [CLI Guide](https://docs.dexto.ai/docs/guides/cli/overview) for full details.

### Skip Tool Prompts While Prototyping

```bash
dexto --auto-approve "refactor my project using the filesystem and browser tools"
```

Use the `--auto-approve` flag to bypass confirmation prompts when you trust the tools being invoked—perfect for fast local iteration. Remove the flag when you want explicit approval again.

### Logs

Logs are stored in `~/.dexto/logs` directory by default.

Use `DEXTO_LOG_TO_CONSOLE=true` to log to console when running dexto.

Use `DEXTO_LOG_LEVEL=debug` for debug logs.

## Agent Recipes

Dexto comes with pre-built agent recipes for common use cases. Install and use them instantly:

```bash
# List available agents
dexto list-agents

# Install specific agents
dexto install nano-banana-agent podcast-agent coding-agent

# Use an agent with one shot prompt
dexto --agent nano-banana-agent --mode cli "create a futuristic cityscape with flying cars"
dexto --agent podcast-agent --mode cli "generate a podcast intro with two hosts discussing AI"
dexto --agent coding-agent --mode cli "create a landing page for a coffee brand inspired by star wars"

# Alternatively, start the agent in web UI and put in the prompt yourself
dexto --agent nano-banana-agent
```

**Available Agents:**
- **Coding Agent** – Code generation, refactoring, debugging
- **Nano Banana Agent** – Advanced image generation and editing using Google's Nano Banana (Gemini 2.5 Flash Image)
- **Podcast Agent** – Advanced podcast generation using Google Gemini TTS for multi-speaker audio content
- **Sora Video Agent** – AI video generation using OpenAI's Sora with custom settings, remixing, and reference support
- **Database Agent** – Demo agent for SQL queries and database operations
- **GitHub Agent** – GitHub operations, PR analysis, and repository management
- **Image Editor Agent** – Image editing and manipulation
- **Music Agent** – Music creation and audio processing
- **Talk2PDF Agent** – Document analysis and conversation
- **Product Researcher** – Product naming and branding research
- **Triage Agent** – Demo multi-agent customer support routing system
- **Workflow Builder Agent** – Build and manage n8n automation workflows
- **Product Analysis Agent** – Product analytics and insights using PostHog
- **Gaming Agent** – Play GameBoy games like Pokemon through an emulator

Each agent is pre-configured with the right tools, prompts, and LLM settings for its domain. No setup required—just install and start building.

**📚 See the full [Agent Registry](https://docs.dexto.ai/docs/guides/agent-registry) for detailed information about all agents, their capabilities, use cases, and requirements.**

More ready-to-run recipes live in [`agents/`](https://github.com/truffle-ai/dexto/tree/HEAD/agents/).

## Examples & Demos

### 🎙️ Podcast Agent: Generate AI Podcasts
**Task:** `Generate an intro for a podcast about the latest in AI.`
```bash
dexto --agent podcast-agent
```

<img src="https://github.com/user-attachments/assets/cfd59751-3daa-4ccd-97b2-1b2862c96af1" alt="Podcast Agent Demo" width="600"/>

### 👁️ Computer Vision Agent: Face Detection & Annotation Using OpenCV
**Task:** `Detect all faces in this image and draw bounding boxes around them.`
```bash
dexto --agent image-editor-agent
```

<img src="https://github.com/user-attachments/assets/7e4b2043-c39a-47c7-a403-a9665ee762ce" alt="Face Detection Demo" width="600">

### 🎮 Coding Agents: Create apps on demand

Build full-stack applications, websites, and interactive games with AI-powered coding agents. Customize them to create your own coding agents.

**Task:** `Can you create a snake game in a new folder and open it when done?`
```bash
dexto --agent coding-agent
```

<img src=".github/assets/coding_agent_demo.gif" alt="Snake Game Development Demo" width="600"/>


### 📧 Portable Agents: Use your agents from Cursor

Dexto agents are designed to be modular, composable and portable, allowing you to run them from anywhere. In this example, we connect to dexto as an MCP server via Cursor to use our podcast agent from above.

<img src="https://github.com/user-attachments/assets/fd75a63f-4d29-447a-be24-6943e34c387f" alt="Email to Slack Demo" width="600">



### 🎯 Triage Agent: Multi-Agent Customer Support

Create multi-agent systems that can intelligently coordinate and delegate tasks among themselves based on the user query.

```bash
dexto --agent triage-agent
```
<img src=".github/assets/triage_agent_demo.gif" alt="Triage Agent Demo" width="600">

### 🛠️ Adding Custom MCP Servers

You can add your own Model Context Protocol (MCP) servers to extend Dexto's capabilities with new tools or data sources. Just edit your agent YAML or add it directly in the WebUI.

<img src="https://github.com/user-attachments/assets/1a3ca1fd-31a0-4e1d-ba93-23e1772b1e79" alt="Add MCP Server Example" width="600"/>

### 🧠 Memory: Persistent Context & Learning

Create and save memories. Your agent automatically uses it to create personalized experiences.

<img src=".github/assets/memory_demo.gif" alt="Memory Demo" width="600">

### 🛒 MCP Store: Tool Discovery & Integration

Equip your agents from 20+ MCP Servers and start using them via chat - instantly.
- Bring your own keys
- Can't find an MCP? [Contribute here!](https://github.com/truffle-ai/dexto/blob/main/CONTRIBUTING.md)  

<img src=".github/assets/mcp_store_demo.gif" alt="MCP Store Demo" width="600">

### 📝 Human In The Loop: Dynamic Form Generation

Agents can generate structured forms when they need additional data to make it easier to collect extra info & approvals from users.

<img src=".github/assets/user_form_demo.gif" alt="User Form Demo" width="600">



#### More Examples:

<details>
<summary><strong>🛒 Browser Agent: Amazon Shopping Assistant</strong></summary>

**Task:** `Can you go to amazon and add some snacks to my cart? I like trail mix, cheetos and maybe surprise me with something else?`
```bash
# Default agent has browser tools
dexto
```
<a href="https://youtu.be/C-Z0aVbl4Ik">
  <img src="https://github.com/user-attachments/assets/3f5be5e2-7a55-4093-a071-8c52f1a83ba3" alt="Dexto: Amazon shopping agent demo" width="600"/>
</a>

</details>

<details>
<summary><strong>🎮 Playground: Interactive Development Environment</strong></summary>

A testing playground to view the tools in your MCP servers before connecting them to LLMs to see the detailed response structures.

<img src=".github/assets/playground_demo.gif" alt="Playground Demo" width="600">

</details>

<details>
<summary><strong>📧 Email to Slack: Automated Email Summaries</strong></summary>

**Task:** `Summarize emails and send highlights to Slack`
```bash
dexto --agent ./agents/examples/email_slack.yml
```
<img src="https://github.com/truffle-ai/dexto/blob/HEAD/assets/email_slack_demo.gif?raw=1" alt="Email to Slack Demo" width="600">

</details>

<details>
<summary><strong>🖼️ Hugging Face: Image Generation</strong></summary>

**Task:** `Generate a photo of a baby panda.`

<img src="https://github.com/user-attachments/assets/570cbd3a-6990-43c5-b355-2b549a4ee6b3" alt="Hugging Face Image Generation Demo" width="600"/>

</details>

---

## Run Modes

| Mode | Command | Best for |
|------|---------|----------|
| **Web UI** | `dexto` | Friendly chat interface w/ image support (default) |
| **Interactive CLI** | `dexto --mode cli` | Everyday automation & quick tasks |
| **Headless Server** | `dexto --mode server` | REST & SSE streaming APIs for agent interaction |
| **MCP Server (Agent)** | `dexto --mode mcp` | Exposing your agent as a tool for others via stdio |
| **MCP Server (Aggregator)** | `dexto mcp --group-servers` | Re-exposing tools from multiple MCP servers via stdio |
| **Discord Bot** | [See `examples/discord-bot/`](examples/discord-bot/) | Community servers & channels (reference implementation) |
| **Telegram Bot** | [See `examples/telegram-bot/`](examples/telegram-bot/) | Mobile chat (reference implementation) |

Run `dexto --help` for **all flags, sub-commands, and environment variables**.

## Configuration

### Agent Configuration

Dexto treats each configuration as a unique agent allowing you to define and save combinations of LLMs, servers, storage options, etc. based on your needs for easy portability. Define agents in version-controlled YAML. Change the file, reload, and chat—state, memory, and tools update automatically.

Example configuration:

```yaml
# agents/my-agent.yml
llm:
  provider: openai
  model: gpt-5-mini
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
| **OpenAI** | `gpt-5.1-chat-latest`, `gpt-5.1`, `gpt-5.1-codex`, `gpt-5.1-codex-mini`, `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5-pro`, `gpt-5-codex`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`, `gpt-4o-mini`, `gpt-4o-audio-preview`, `o4-mini`, `o3`, `o3-mini`, `o1` | `change model in UI and add api key` |
| **Anthropic** | `claude-haiku-4-5-20251001`, `claude-sonnet-4-5-20250929`, `claude-opus-4-5-20251101`, `claude-opus-4-1-20250805`, `claude-4-opus-20250514`, `claude-4-sonnet-20250514`, `claude-3-7-sonnet-20250219`, `claude-3-5-sonnet-20240620`, `claude-3-5-haiku-20241022` | `change model in UI and add api key` |
| **Google** | `gemini-3-pro-preview`, `gemini-3-pro-image-preview`, `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash`, `gemini-2.0-flash-lite` | `change model in UI and add api key` |
| **Groq** | `llama-3.3-70b-versatile`, `meta-llama/llama-4-scout-17b-16e-instruct`, `meta-llama/llama-4-maverick-17b-128e-instruct`, `qwen/qwen3-32b`, `gemma-2-9b-it`, `openai/gpt-oss-20b`, `openai/gpt-oss-120b`, `moonshotai/kimi-k2-instruct`, `deepseek-r1-distill-llama-70b` | `change model in UI and add api key` |
| **xAI** | `grok-4`, `grok-3`, `grok-3-mini`, `grok-code-fast-1` | `change model in UI and add api key` |
| **Cohere** | `command-a-03-2025`, `command-r-plus`, `command-r`, `command-r7b` | `change model in UI and add api key` |

```bash
# Switch models via CLI
dexto -m claude-sonnet-4-5-20250929
dexto -m gemini-2.5-pro
```

You can configure things like LLM, system prompt, MCP servers, storage, sessions, human-in-the loop, telemetry and more!

See our [Configuration Guide](https://docs.dexto.ai/docs/category/agent-configuration-guide) for complete setup instructions.


## Dexto Agent SDK

Build AI agents programmatically with the `@dexto/core` package. Everything the CLI can do, your code can too.

```bash
npm install @dexto/core
```

```ts
import { DextoAgent } from '@dexto/core';

// Create and start agent
const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-5-mini',
    apiKey: process.env.OPENAI_API_KEY
  }
});
await agent.start();

// Create a session for the conversation
const session = await agent.createSession();

// Use generate() for simple request/response
const response = await agent.generate('What is TypeScript?', session.id);
console.log(response.content);

// Conversations maintain context within a session
await agent.generate('Write a haiku about it', session.id);
await agent.generate('Make it funnier', session.id);

// Multimodal: send images or files
await agent.generate([
  { type: 'text', text: 'Describe this image' },
  { type: 'image', image: base64Data, mimeType: 'image/png' }
], session.id);

// Streaming for real-time UIs
for await (const event of await agent.stream('Write a story', session.id)) {
  if (event.name === 'llm:chunk') process.stdout.write(event.content);
}

await agent.stop();
```

See our [Dexto Agent SDK docs](https://docs.dexto.ai/docs/guides/dexto-sdk) for multimodal content, streaming, MCP tools, and advanced features.

---

## Advanced Usage

### Starting a Server

Start a Dexto server programmatically to expose REST and SSE streaming APIs to interact and manage your agent backend.

```typescript
import { DextoAgent } from '@dexto/core';
import { startHonoApiServer } from 'dexto';

// Create and configure agent
const agent = new DextoAgent({
  llm: {
    provider: 'openai',
    model: 'gpt-5-mini',
    apiKey: process.env.OPENAI_API_KEY
  },
  mcpServers: {
    filesystem: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
    }
  }
});

// Start server on port 3001
const { server } = await startHonoApiServer(agent, 3001);

console.log('Dexto server running at http://localhost:3001');
// Server provides REST API and SSE streaming endpoints
// POST /api/message - Send messages
// GET /api/sessions - List sessions
// See docs.dexto.ai/api/rest/ for all endpoints
```

This starts an HTTP server with full REST and SSE APIs, enabling integration with web frontends, webhooks, and other services. See the [REST API Documentation](https://docs.dexto.ai/api/rest/) for available endpoints.

### Session Management

Create and manage multiple conversation sessions with persistent storage.

```typescript
const agent = new DextoAgent(config);
await agent.start();

// Create and manage sessions
const session = await agent.createSession('user-123');
await agent.generate('Hello, how can you help me?', session.id);

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
await agent.switchLLM({ model: 'gpt-5-mini' });
await agent.switchLLM({ model: 'claude-sonnet-4-5-20250929' });

// Switch model for a specific session id 1234
await agent.switchLLM({ model: 'gpt-5-mini' }, '1234')

// Get supported providers and models
const providers = agent.getSupportedProviders();
const models = agent.getSupportedModels();
const openaiModels = agent.getSupportedModelsForProvider('openai');
```

### MCP Manager

For advanced MCP server management, use the MCPManager directly. See the [MCP Manager SDK docs](https://docs.dexto.ai/api/sdk/mcp-manager) for full details.

```typescript
import { MCPManager } from '@dexto/core';

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

Configure storage backends for production-ready persistence and caching. See the [Storage Configuration guide](https://docs.dexto.ai/docs/guides/configuring-dexto/storage) for full details.

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

See the [DextoAgent API Documentation](https://docs.dexto.ai/api/sdk/dexto-agent) for complete method references.

---

## CLI Reference

<details>
<summary>Click to expand for full CLI reference (`dexto --help`)</summary>

```
Usage: dexto [options] [command] [prompt...]

Dexto CLI - AI-powered assistant with session management

Basic Usage:
  dexto                    Start web UI (default)
  dexto "query"            Run one-shot query (auto-uses CLI mode)
  dexto -p "query"         Run one-shot query, then exit
  cat file | dexto -p "query"  Process piped content

CLI Mode:
  dexto --mode cli         Start interactive CLI REPL

Session Management:
  dexto -c                 Continue most recent conversation
  dexto -c -p "query"      Continue with one-shot query, then exit
  dexto -r "<session-id>" "query"  Resume with one-shot query

Tool Confirmation:
  dexto --auto-approve     Auto-approve all tool executions

Agent Selection:
  dexto --agent coding-agent       Use installed agent by name
  dexto --agent ./my-agent.yml     Use agent from file path
  dexto -a agents/custom.yml       Short form with relative path

Advanced Modes:
  dexto --mode server      Run as API server
  dexto --mode mcp         Run as MCP server

Platform Integrations (Reference Implementations):
  See examples/discord-bot/     Run as Discord bot
  See examples/telegram-bot/    Run as Telegram bot

Session Commands: dexto session list|history|delete • search
Search: dexto search <query> [--session <id>] [--role <role>]

See https://docs.dexto.ai for documentation and examples

Arguments:
  prompt                           Natural-language prompt to run once. If not
                                   passed, dexto will start as an interactive
                                   CLI

Options:
  -v, --version                    output the current version
  -a, --agent <id|path>            Agent ID or path to agent config file
  -p, --prompt <text>              Run prompt and exit. Alternatively provide a
                                   single quoted string as positional argument.
  -s, --strict                     Require all server connections to succeed
  --no-verbose                     Disable verbose output
  --no-interactive                 Disable interactive prompts and API key
                                   setup
  --skip-setup                     Skip global setup validation (useful for MCP
                                   mode, automation)
  -m, --model <model>              Specify the LLM model to use
  --auto-approve                   Always approve tool executions without
                                   confirmation prompts
  -c, --continue                   Continue most recent conversation
  -r, --resume <sessionId>         Resume session by ID
  --mode <mode>                    The application in which dexto should talk
                                   to you - web | cli | server | mcp
                                   (default: "web")
  --port <port>                    port for the server (default: 3000 for web,
                                   3001 for server mode)
  --no-auto-install                Disable automatic installation of missing
                                   agents from registry
  -h, --help                       display help for command

Commands:
  create-app                       Scaffold a new Dexto Typescript app
  init-app                         Initialize an existing Typescript app with
                                   Dexto
  setup [options]                  Configure global Dexto preferences
  install [options] [agents...]    Install agents from registry or custom YAML
                                   files/directories
  uninstall [options] [agents...]  Uninstall agents from the local installation
  list-agents [options]            List available and installed agents
  which <agent>                    Show the path to an agent
  session                          Manage chat sessions
  search [options] <query>         Search session history
  mcp [options]                    Start Dexto as an MCP server. Use
                                   --group-servers to aggregate and re-expose
                                   tools from configured MCP servers.
                                   In the future, this command will expose the
                                   agent as an MCP server by default.
```
</details>

See the [CLI Guide](https://docs.dexto.ai/docs/guides/cli/overview) for full details.

---

## Next Steps

* **[Quick Start](https://docs.dexto.ai/docs/getting-started/intro/)** – Get up and running in minutes.
* **[Configuration Guide](https://docs.dexto.ai/docs/category/guides/)** – Configure agents, LLMs, and tools.
* **[Building with Dexto](https://docs.dexto.ai/docs/category/tutorials/)** – Developer guides and patterns.
* **[API Reference](https://docs.dexto.ai/api/)** – REST APIs, SSE streaming, and SDKs.

---

## Telemetry

We collect anonymous usage data (no personal/sensitive info) to help improve Dexto. This includes:

- Commands used
- Command execution time
- Error occurrences
- System information (OS, Node version)
- LLM Models used

To opt-out:

Set env variable `DEXTO_ANALYTICS_DISABLED=1` 

## Contributing

We welcome contributions! Refer to our [Contributing Guide](https://github.com/truffle-ai/dexto/blob/HEAD/CONTRIBUTING.md) for more details.

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

Elastic License 2.0.  See [LICENSE](https://github.com/truffle-ai/dexto/blob/HEAD/LICENSE) for full terms.
