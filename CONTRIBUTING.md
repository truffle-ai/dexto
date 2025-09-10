## Contributing

We welcome contributions! Here's how to get started:

1. Fork the repository to your GitHub account.
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/dexto.git
   cd dexto
   ```
3. Create a new feature branch:
   ```bash
   git checkout -b feature/your-branch-name
   ```
4. Make your changes:
   - Follow existing TypeScript and code style conventions.
   - Run `npm run lint:fix` and `npm run format` before committing.
   - Add or update tests for new functionality.
5. Commit and push your branch:
   ```bash
   git commit -m "Brief description of changes"
   git push origin feature/your-branch-name
   ```
6. Open a Pull Request against the `main` branch with a clear description of your changes.

*Tip:* Open an issue first for discussion on larger enhancements or proposals.

## Contributing MCPs and Example Agents

We especially encourage contributions that expand Dexto's ecosystem! Here are three ways you can contribute:

### 1. Adding New MCPs to the WebUI Registry

Help other users discover and use new MCP servers by adding them to our built-in registry.

**How to add an MCP to the registry:**

1. Edit `src/app/webui/lib/server-registry-data.json`
2. Add a new entry following this structure:

```json
{
  "id": "unique-server-id",
  "name": "Display Name",
  "description": "Brief description of what this server does",
  "category": "productivity|research|creative|development|data|communication",
  "icon": "📁",
  "config": {
    "type": "stdio|http|sse",
    "command": "npx|uvx|python",
    "args": ["-y", "package-name"],
    "env": {
      "API_KEY": ""
    },
    "timeout": 30000
  },
  "tags": ["tag1", "tag2"],
  "isOfficial": false,
  "isInstalled": false,
  "requirements": {
    "platform": "all|windows|mac|linux",
    "node": ">=20.0.0",
    "python": ">=3.10"
  },
  "author": "Your Name",
  "homepage": "https://github.com/your-repo",
  "matchIds": ["server-id"]
}
```

**Categories:**
- `productivity` - File operations, task management, workflow tools
- `research` - Search, data analysis, information gathering  
- `creative` - Image editing, music creation, content generation
- `development` - Code analysis, debugging, development tools
- `data` - Data processing, analytics, databases
- `communication` - Email, messaging, collaboration tools

**Configuration Types:**
- **Stdio (Node.js)**: `{"type": "stdio", "command": "npx", "args": ["-y", "package-name"]}`
- **Stdio (Python)**: `{"type": "stdio", "command": "uvx", "args": ["package-name"]}`
- **HTTP**: `{"type": "http", "baseUrl": "https://api.example.com/mcp"}`
- **SSE**: `{"type": "sse", "url": "https://api.example.com/mcp-sse"}`

### 2. Creating Example Agents

Showcase how to use MCPs by creating example agents in the `agents/` directory.

**How to create an example agent:**

1. Create a new directory: `agents/your-agent-name/`
2. Add a `your-agent-name.yml` configuration file
3. Include a `README.md` with setup instructions and usage examples
4. Follow the existing agent structure (see `agents/examples/` for reference)

**Example agent structure:**
```
agents/your-agent-name/
├── your-agent-name.yml    # Main configuration
├── README.md             # Setup and usage guide
└── data/                 # Optional: sample data
    └── example.json
```

**Configuration template:**
```yaml
# Your Agent Name
# Brief description of what this agent does

systemPrompt: |
  You are a [Agent Name] specialized in [purpose]. You have access to [MCP servers] that allow you to:
  
  ## Your Capabilities
  - [List key capabilities]
  - [More capabilities]
  
  ## How You Should Behave
  - [Behavior guidelines]
  - [Usage examples]

mcpServers:
  your-mcp:
    type: stdio
    command: npx
    args:
      - -y
      - "package-name"
    env:
      API_KEY: $YOUR_API_KEY

llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY

storage:
  cache:
    type: in-memory
  database:
    type: sqlite
    path: .dexto/database/your-agent.db
```

**README template:**
```markdown
# Your Agent Name

Brief description of what this agent does and why it's useful.

## Features
- Feature 1
- Feature 2

## Setup
1. Install dependencies: `npm install`
2. Set environment variables: `export YOUR_API_KEY=your-key`
3. Run the agent: `dexto --agent your-agent-name.yml`

## Usage Examples
- "Example command 1"
- "Example command 2"

## Requirements
- Node.js >= 20.0.0
- Your API key
```

### 3. Requesting Pre-installed Agent Status

For widely-useful agents, you can request to have them added to our official agent registry.

**How to request pre-installed status:**

1. Create a comprehensive example agent (following step 2 above)
2. Test it thoroughly and document all features
3. Open an issue with the label `agent-registry-request`
4. Include:
   - Link to your agent directory
   - Description of the agent's purpose and value
   - Screenshots or demos if applicable
   - Why it should be pre-installed

**Criteria for pre-installed agents:**
- Solves a common, well-defined problem
- Has clear documentation and examples
- Works reliably across different environments
- Provides significant value to the Dexto community
- Follows all coding standards and best practices

### Documentation
- Update relevant documentation in `/docs` folder
- Include clear examples in your contributions
- Follow the existing documentation structure

*Tip:* Check out existing examples in `agents/examples/` and `agents/database-agent/` for inspiration! 