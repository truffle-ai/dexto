# Configuration Guide

Dexto uses a YAML configuration file to define tool servers and AI settings. This guide provides detailed information on all available configuration options.

## Configuration File Location

By default, Dexto looks for a configuration file at `agents/coding-agent/coding-agent.yml` in the project directory. You can specify a different location using the `--agent` command-line option:

```bash
npm start -- --agent path/to/your/agent.yml
```

## Configuration Structure

The configuration file has two main sections:

1. `mcpServers`: Defines the tool servers to connect to
2. `llm`: Configures the AI provider settings

### Basic Example

```yaml
mcpServers:
  github:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-github"
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: your-github-token
  filesystem:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - .
llm:
  provider: openai
  model: gpt-5
  apiKey: $OPENAI_API_KEY
```

## Tool Server Configuration

Each entry under `mcpServers` defines a tool server to connect to. The key (e.g., "github", "filesystem") is used as a friendly name for the server.

Tool servers can either be local servers (stdio) or remote servers (sse)

### Stdio Server Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `type` | string | Yes | The type of the server, needs to be 'stdio' |
| `command` | string | Yes | The executable to run |
| `args` | string[] | No | Array of command-line arguments |
| `env` | object | No | Environment variables for the server process |

### SSE Server Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `type` | string | Yes | The type of the server, needs to be 'sse' |
| `url` | string | Yes | The url of the server |
| `headers` | map | No | Optional headers for the url |

## LLM Configuration

The `llm` section configures the AI provider settings.

### LLM Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `provider` | string | Yes | AI provider (e.g., "openai", "anthropic", "google") |
| `model` | string | Yes | The model to use |
| `apiKey` | string | Yes | API key or environment variable reference |
| `temperature` | number | No | Controls randomness (0-1, default varies by provider) |
| `maxInputTokens` | number | No | Maximum input tokens for context compression |
| `maxOutputTokens` | number | No | Maximum output tokens for response length |
| `baseURL` | string | No | Custom API endpoint for OpenAI-compatible providers |

### API Key Configuration

#### Setting API Keys

API keys can be configured in two ways:

1. **Environment Variables (Recommended)**:
   - Add keys to your `.env` file (use `.env.example` as a template) or export environment variables
   - Reference them in config with the `$` prefix

2. **Direct Configuration** (Not recommended for security):
   - Directly in the YAML file (less secure, avoid in production)

```yaml
# Recommended: Reference environment variables
apiKey: $OPENAI_API_KEY

# Not recommended: Direct API key in config
apiKey: sk-actual-api-key  
```

#### Security Best Practices
- Never commit API keys to version control
- Use environment variables in production environments
- Create a `.gitignore` entry for your `.env` file

#### API Keys for Different Providers
Each provider requires its own API key:
- OpenAI: Set `OPENAI_API_KEY` in `.env` 
- Anthropic: Set `ANTHROPIC_API_KEY` in `.env`
- Google Gemini: Set `GOOGLE_GENERATIVE_AI_API_KEY` in `.env`

#### Openai example
```yaml
llm:
  provider: openai
  model: gpt-5
  apiKey: $OPENAI_API_KEY
```

#### Anthropic example
```yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY
```

#### Google example
```yaml
llm:
  provider: google
  model: gemini-2.0-flash
  apiKey: $GOOGLE_GENERATIVE_AI_API_KEY
```

## Optional Greeting

Add a simple `greeting` at the root of your config to provide a default welcome text that UI layers can display when a chat starts:

```yaml
greeting: "Hi! I’m Dexto — how can I help today?"
```

### Windows Support

On Windows systems, some commands like `npx` may have different paths. The system attempts to automatically detect and uses the correct paths for these commands on Windows. If you run into any issues during server initialization, you may need to adjust the path to your `npx` command.

## Supported Tool Servers

Here are some commonly used MCP-compatible tool servers:

### GitHub

```yaml
github:
  type: stdio
  command: npx
  args:
    - -y
    - "@modelcontextprotocol/server-github"
  env:
    GITHUB_PERSONAL_ACCESS_TOKEN: your-github-token
```

### Filesystem

```yaml
filesystem:
  type: stdio
  command: npx
  args:
    - -y
    - "@modelcontextprotocol/server-filesystem"
    - .
```

### Terminal

```yaml
terminal:
  type: stdio
  command: npx
  args:
    - -y
    - "@modelcontextprotocol/server-terminal"
```

### Desktop Commander

```yaml
desktop:
  type: stdio
  command: npx
  args:
    - -y
    - "@wonderwhy-er/desktop-commander"
```

### Custom Server

```yaml
custom:
  type: stdio
  command: node
  args:
    - --loader
    - ts-node/esm
    - src/servers/customServer.ts
  env:
    API_KEY: your-api-key
```

### Remote Server

This example uses a remote github server provided by composio.
The URL is just a placeholder which won't work out of the box since the URL is customized per user.
Go to mcp.composio.dev to get your own MCP server URL.

```yaml
github-remote:
  type: sse
  url: https://mcp.composio.dev/github/repulsive-itchy-alarm-ABCDE
```

## Command-Line Options

Dexto supports several command-line options:

| Option | Description |
|--------|-------------|
| `--agent` | Specify a custom agent configuration file |
| `--strict` | Require all connections to succeed |
| `--verbose` | Enable verbose logging |
| `--help` | Show help |

## Available Agent Examples

### Database Agent
An AI agent that provides natural language access to database operations and analytics. This approach simplifies database interaction - instead of building forms, queries, and reporting dashboards, users can simply ask for what they need in plain language.

**Quick Start:**
```bash
cd database-agent
./setup-database.sh
npm start -- --agent database-agent.yml
```

**Example Interactions:**
- "Show me all users"
- "Create a new user named John Doe with email john@example.com"
- "Find products under $100"
- "Generate a sales report by category"

This agent demonstrates intelligent database interaction through conversation.

## Complete Example

Here's a comprehensive configuration example using multiple tool servers:

```yaml
mcpServers:
  github:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-github"
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: your-github-token
  filesystem:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - .
  terminal:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-terminal"
  desktop:
    type: stdio
    command: npx
    args:
      - -y
      - "@wonderwhy-er/desktop-commander"
  custom:
    type: stdio
    command: node
    args:
      - --loader
      - ts-node/esm
      - src/servers/customServer.ts
    env:
      API_KEY: your-api-key
llm:
  provider: openai
  model: gpt-5
  apiKey: $OPENAI_API_KEY
``` 
