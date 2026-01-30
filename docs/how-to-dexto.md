# Dexto Usage Guide for LLM Agents

This document provides a concise guide for using the Dexto agent runtime, optimized for RAG and consumption by other LLMs.

---

## 1. Core Concepts

### What is Dexto?
Dexto is a lightweight runtime for creating and running AI agents. It translates natural language prompts into actions using configured tools and LLMs. It can be controlled via CLI, a programmatic SDK, or a REST API.

### Installation
Install the Dexto CLI globally via npm:
```bash
npm install -g dexto
```

### LLM API Keys
Dexto requires API keys for the desired LLM provider. Set them as environment variables.
```bash
# For OpenAI (e.g., gpt-5)
export OPENAI_API_KEY="your_key"

# For Anthropic (e.g., claude-sonnet-4-5-20250929)
export ANTHROPIC_API_KEY="your_key"

# For Google (e.g., gemini-2.5-pro)
export GOOGLE_GENERATIVE_AI_API_KEY="your_key"

# For Cohere (e.g., command-r-plus)
export COHERE_API_KEY="your_key"
```

### Agent Configuration (`coding-agent.yml`)
Agent behavior is defined in a YAML file (default: `agents/coding-agent/coding-agent.yml`). This file specifies the LLM, tools (via MCP servers), and system prompt.

**Example `agent.yml`:**
```yaml
# Connect to tool servers via Model Context Protocol (MCP)
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
  playwright:
    type: stdio
    command: npx
    args:
      - "-y"
      - "@playwright/mcp@latest"

# Configure the Large Language Model
llm:
  provider: openai
  model: gpt-5-mini
  apiKey: $OPENAI_API_KEY # Reads from environment variable

# Define the agent's persona and instructions
systemPrompt: |
  You are Dexto, an expert coding assistant.
  You have access to a filesystem and a browser.
  Think step-by-step to solve the user's request.
```

### Advanced System Prompt Configuration

For more complex system prompts, you can use the contributor-based configuration format that allows mixing static content, dynamic content, and file-based context:

```yaml
systemPrompt:
  contributors:
    - id: main-prompt
      type: static
      priority: 0
      content: |
        You are Dexto, an expert coding assistant.
        You have access to a filesystem and a browser.
    
    - id: project-context
      type: file
      priority: 10
      files:
        - "${{dexto.agent_dir}}/README.md"              # Expands to the agent directory at load time
        - "${{dexto.agent_dir}}/docs/architecture.md"   
        - "${{dexto.agent_dir}}/CONTRIBUTING.md"        
      options:
        includeFilenames: true
        separator: "\n\n---\n\n"
        errorHandling: "skip"
        maxFileSize: 50000
        includeMetadata: false
    
    - id: current-time
      type: dynamic
      priority: 20
      source: date
    
    - id: mcp-resources
      type: dynamic
      priority: 25
      source: resources
      enabled: true
```

**File Contributor Options:** (paths must be absolute or use `${{dexto.agent_dir}}` to keep configs portable)
- `files`: Array of file paths to include (.md and .txt files only)
- `options.includeFilenames`: Whether to include filename headers (default: true)
- `options.separator`: Text to separate multiple files (default: "\n\n---\n\n")
- `options.errorHandling`: How to handle missing files - "skip" or "error" (default: "skip")
- `options.maxFileSize`: Maximum file size in bytes (default: 100000)
- `options.includeMetadata`: Include file size and modification time (default: false)

**Note:** Files are always read using UTF-8 encoding.

**Dynamic Contributor Sources:**
- `date`: Automatically adds current date
- `resources`: Includes resources from connected MCP servers (disabled by default for performance)

**Use Cases for File Contributors:**
- Include project documentation and guidelines
- Add code style guides and best practices
- Provide domain-specific knowledge from markdown files
- Include API documentation or specification files
- Add context-specific instructions for different projects

**Use Cases for MCP Resources:**
- Include database schemas from database MCP servers
- Add configuration files from configuration MCP servers  
- Include documentation from documentation MCP servers
- Provide real-time context from connected services

---

## 2. Usage Methods

Dexto can be used via its CLI, the Dexto SDK for TypeScript, or as a server with a REST API.

### Method 1: CLI Usage

The `dexto` command can run one-shot prompts or start in different modes.

**One-shot prompt:**
Execute a task directly from the command line.
```bash
dexto "create a new file named test.txt with hello world content"
# or use explicit -p flag
dexto -p "create a new file named test.txt with hello world content"
```

**Interactive CLI:**
Start a chat session in the terminal.
```bash
dexto
```

**Key CLI Flags:**
- `-m, --model <model_name>`: Switch LLM model (e.g., `claude-sonnet-4-5-20250929`). Overrides config file.
- `-a, --agent <path/to/agent.yml>`: Use a specific agent configuration file.
- `--mode <mode>`: Change the run mode.
- `--new-session [id]`: Start a new chat session.

**CLI Run Modes (`--mode`):**

| Mode       | Command                       | Description                               |
|------------|-------------------------------|-------------------------------------------|
| `web`      | `dexto`                       | Starts a web UI (default mode, port: 3000).|
| `cli`      | `dexto --mode cli`            | Interactive or one-shot terminal commands.|
| `server`   | `dexto --mode server`         | Starts a REST/SSE streaming server (port: 3001).|
| `mcp`      | `dexto --mode mcp`            | Exposes the agent as a tool via MCP/stdio.|
| `discord`  | `dexto --mode discord`        | Runs the agent as a Discord bot.          |
| `telegram` | `dexto --mode telegram`       | Runs the agent as a Telegram bot.         |

**Project Scaffolding:**
- `dexto create-app`: Create a new Dexto project structure.
- `dexto init-app`: Initialize Dexto in an existing TypeScript project.

### Method 2: Programmatic SDK (`DextoAgent`)

Use the `DextoAgent` class in your TypeScript/JavaScript projects for full programmatic control.

**Installation for a project:**
```bash
npm install dexto
```

**Example SDK Usage:**
```ts
import 'dotenv/config';
import { DextoAgent, loadAgentConfig } from '@dexto/core';

// Load configuration from default location (auto-discovery)
const config = await loadAgentConfig();

// Or load from a specific file
// const config = await loadAgentConfig('./agents/coding-agent/coding-agent.yml');

// Create and start the agent
const agent = new DextoAgent(config);
await agent.start(); // Initializes services like MCP servers

// Create a session for the conversation
const session = await agent.createSession();

// Run a single task
const response = await agent.generate('List the 3 largest files in the current directory.', session.id);
console.log(response.content);

// Hold a conversation (state is maintained within the session)
await agent.generate('Write a function that adds two numbers.', session.id);
await agent.generate('Now add type annotations to it.', session.id);

// Reset the conversation history
await agent.resetConversation(session.id);

// Stop the agent and disconnect services
await agent.stop();
```

### Method 3: REST API (Server Mode)

Run Dexto as a headless server to interact with it via HTTP requests.

**Start the server:**
```bash
# The server will run on http://localhost:3001 by default
dexto --mode server
```

**Key API Endpoints:**
- `POST /api/message-stream`: Send a prompt and stream the response via SSE.
  - Body: `{ "sessionId": "your-session-id", "message": "your prompt here" }`
  - Response: SSE stream (text/event-stream)
- `POST /api/message-sync`: Send a prompt and wait for the complete response.
  - Body: `{ "sessionId": "your-session-id", "message": "your prompt here" }`
  - Response: JSON with complete text
- `POST /api/message`: ⚠️ **Deprecated** - Send asynchronously (use `/api/message-stream` instead)

```ts
// POST to /api/message-stream - response IS the SSE stream
const response = await fetch('http://localhost:3001/api/message-stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: 'demo-session', message: 'Summarize the news' })
});

// Response body is the SSE stream
const reader = response.body!.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log(decoder.decode(value));
}
```
- `POST /api/reset`: Resets the current conversation session.
- `GET /api/mcp/servers`: Lists the connected MCP tool servers.

---

## 3. Tools and the Model Context Protocol (MCP)

Dexto uses the **Model Context Protocol (MCP)** to communicate with tools. Tools run as separate server processes. You connect Dexto to them by listing them under `mcpServers` in your `agent.yml`.

**Common Tool Servers:**
- **`@modelcontextprotocol/server-filesystem`**: Provides tools for reading, writing, and listing files.
- **`@truffle-ai/puppeteer-server`**: Provides tools for web browsing and scraping.
- **`@truffle-ai/web-search`**: Provides tools for performing web searches.

**Executing Tools:**
When an LLM agent uses Dexto, it should issue natural language commands. Dexto's LLM will determine which tool to call. The agent's `systemPrompt` should inform the LLM about the available tools (e.g., "You have access to a filesystem and a browser"). The LLM then generates tool calls that Dexto executes. 
