---
sidebar_position: 3
---

# Building Multi-Agent Systems

Learn how to build multi-agent systems where Dexto agents can communicate with each other using the Model Context Protocol (MCP). This powerful pattern enables specialized agents to collaborate and delegate tasks to each other.

## Overview

In this guide, you'll learn how to:
- Set up multiple Dexto agents running on different ports
- Configure one agent to use another as an MCP server
- Enable inter-agent communication through tool calls
- Build collaborative agent workflows

## What We're Building

We'll create two specialized agents:
- **Researcher Agent** (Port 3001): Specializes in gathering and analyzing information
- **Writer Agent** (Port 3002): Specializes in content creation, can call the Researcher for help

The Writer agent will be able to delegate research tasks to the Researcher agent using MCP tool calls.

### Mode Selection Strategy
- **`--mode mcp`**: Use for agents that primarily serve as MCP servers for other agents (like our Researcher)
- **`--mode web`**: Use for agents that need web UI access for user interaction (like our Writer)

Both modes expose the `/mcp` endpoint, but `mcp` mode is optimized for API-only usage.

## Step 1: Create the Project Structure

```bash
mkdir multi-agent-example
cd multi-agent-example

# Create config files for each agent
touch researcher.yml writer.yml .env
```

Your project structure should look like:
```
multi-agent-example/
├── researcher.yml
├── writer.yml
└── .env
```

## Step 2: Set Up the Researcher Agent

### Create Researcher Configuration

Create `researcher.yml`:

```yaml
# Research Agent Configuration
systemPrompt: |
  You are a Research Agent specializing in gathering and analyzing information.
  
  Your capabilities include:
  - Reading and analyzing files using the filesystem tool
  - Searching the web for current information using tavily-search
  - Synthesizing research findings into clear summaries
  
  When responding to research requests:
  1. Use your tools to gather relevant information
  2. Analyze and synthesize the findings
  3. Provide well-structured, factual responses
  4. Include sources and evidence when possible
  
  Be thorough but concise in your research summaries.

llm:
  provider: openai
  model: gpt-4.1-mini
  apiKey: $OPENAI_API_KEY

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - "."
  
  tavily-search:
    type: stdio
    command: npx
    args:
      - -y
      - "tavily-mcp@0.1.2"
    env:
      TAVILY_API_KEY: $TAVILY_API_KEY
```

## Step 3: Set Up the Writer Agent

### Create Writer Configuration

Create `writer.yml`:

```yaml
# Writer Agent - Specializes in content creation
systemPrompt: |
  You are a Content Writer Agent specializing in creating high-quality written content.
  
  Your capabilities include:
  - Writing articles, blog posts, and documentation
  - Reading and editing files using the filesystem tool
  - Collaborating with the Researcher Agent for information gathering
  
  When you need research or factual information:
  1. Use the "researcher" tool to delegate research tasks
  2. Provide clear, specific research requests
  3. Incorporate the research findings into your writing
  
  Example researcher tool usage:
  - "Research the latest trends in AI agents"
  - "Find information about the Model Context Protocol"
  - "Analyze the contents of the project files for context"
  
  Always create well-structured, engaging content that incorporates research findings naturally.

mcpServers:
  filesystem:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - "."
  
  # Connect to the Researcher Agent as an MCP server
  researcher:
    type: http
    baseUrl: http://localhost:3001/mcp
    timeout: 30000

llm:
  provider: openai
  model: gpt-4.1-mini
  apiKey: $OPENAI_API_KEY
```

## Step 4: Set Up Environment Variables

Create `.env`:

```bash
# Add your OpenAI API key
OPENAI_API_KEY=your_openai_key_here

# Add Tavily API key for web search (get free key at tavily.com)
TAVILY_API_KEY=your_tavily_key_here

# Optional: Add other provider keys if using different models
ANTHROPIC_API_KEY=your_anthropic_key
GOOGLE_GENERATIVE_AI_API_KEY=your_google_key
COHERE_API_KEY=your_cohere_key
```

## Step 5: Run the Multi-Agent System

That's it! No custom code needed. Just run Dexto with different configs and ports:

### Terminal 1: Start the Researcher Agent
```bash
dexto --mode mcp --web-port 3001 --agent researcher.yml
```

### Terminal 2: Start the Writer Agent  
```bash
dexto --mode web --web-port 3002 --agent writer.yml
```

### Terminal 3: Test the System
```bash
# Test the researcher directly
curl -X POST http://localhost:3001/api/message-sync \
  -H "Content-Type: application/json" \
  -d '{"message": "Research the latest developments in AI agents"}'

# Test the writer (which can call the researcher)
curl -X POST http://localhost:3002/api/message-sync \
  -H "Content-Type: application/json" \
  -d '{"message": "Write a blog post about AI agent collaboration. Research current trends first."}'
```

You can also open the web interfaces:
- **Researcher**: http://localhost:3001 (API endpoints only)
- **Writer**: http://localhost:3002 (Full web UI)

## How It Works

### Inter-Agent Communication Flow

1. **User Request**: "Write a blog post about AI agents"
2. **Writer Agent**: Recognizes it needs research
3. **Tool Call**: Writer calls the `researcher` tool via HTTP MCP
4. **Research Execution**: Researcher agent processes the research request
5. **Response**: Researcher returns findings to Writer
6. **Content Creation**: Writer incorporates research into the blog post
7. **Final Output**: User receives a well-researched blog post

### MCP Configuration Explained

In the Writer's configuration, this section connects to the Researcher:

```yaml
researcher:
  type: http                           # Use HTTP MCP connection
  baseUrl: http://localhost:3001/mcp   # Researcher's MCP endpoint (auto-available in mcp mode)
  timeout: 30000                       # 30-second timeout
```

When Dexto runs in `mcp` or `web` mode, it automatically exposes an MCP endpoint at `/mcp` that other agents can connect to. The `mcp` mode is specifically designed for agents that primarily serve as MCP servers for other agents.

### The Power of Configuration-First

This example demonstrates Dexto's core philosophy:
- **No custom code** - just YAML configuration
- **Built-in web server** - automatic API and UI
- **Automatic MCP endpoints** - no need to implement protocols
- **Simple scaling** - add more agents by adding more configs

## Advanced Usage Patterns

### 1. Multiple Specialized Agents

```yaml
# Writer agent with multiple specialist agents
mcpServers:
  researcher:
    type: http
    baseUrl: http://localhost:3001/mcp
  
  fact-checker:
    type: http
    baseUrl: http://localhost:3003/mcp
  
  editor:
    type: http
    baseUrl: http://localhost:3004/mcp
```

Then run:
```bash
# Terminal 1: Researcher (MCP server mode)
dexto --mode mcp --web-port 3001 --agent researcher.yml

# Terminal 2: Fact-checker (MCP server mode)
dexto --mode mcp --web-port 3003 --agent fact-checker.yml

# Terminal 3: Editor (MCP server mode)
dexto --mode mcp --web-port 3004 --agent editor.yml

# Terminal 4: Writer (Web UI for user interaction)
dexto --mode web --web-port 3002 --agent writer.yml
```

### 2. Bidirectional Communication

Configure agents to call each other:

```yaml
# In researcher.yml - Researcher can also call Writer for help with summaries
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
  
  writer:
    type: http
    baseUrl: http://localhost:3002/mcp
```

### 3. Agent Orchestration

Create a coordinator agent that manages multiple specialized agents:

```yaml
# coordinator.yml
mcpServers:
  researcher:
    type: http
    baseUrl: http://localhost:3001/mcp
  
  writer:
    type: http
    baseUrl: http://localhost:3002/mcp
  
  reviewer:
    type: http
    baseUrl: http://localhost:3003/mcp

# Coordinator Agent Configuration
systemPrompt: |
    You are a Coordinator Agent that orchestrates work between specialized agents.
    
    Your team includes:
    - researcher: For gathering information and analysis
    - writer: For content creation
    - reviewer: For quality assurance and editing
    
  When given a task, break it down and delegate to the appropriate agents.

llm:
  provider: openai
  model: gpt-4.1-mini
  apiKey: $OPENAI_API_KEY
```

Run the system:
```bash
# Start specialized agents (MCP servers)
dexto --mode mcp --web-port 3001 --agent researcher.yml
dexto --mode mcp --web-port 3002 --agent writer.yml  
dexto --mode mcp --web-port 3003 --agent reviewer.yml

# Start coordinator (Web UI for user interaction)
dexto --mode web --web-port 3000 --agent coordinator.yml
```

## Production Considerations

### 1. Process Management
Use a process manager like PM2 for production:

```bash
# Install PM2
npm install -g pm2

# Create ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [
    {
      name: 'researcher-agent',
      script: 'dexto',
      args: '--mode mcp --web-port 3001 --agent researcher.yml'
    },
    {
      name: 'writer-agent', 
      script: 'dexto',
      args: '--mode web --web-port 3002 --agent writer.yml'
    }
  ]
};
EOF

# Start all agents
pm2 start ecosystem.config.js
```

### 2. Docker Deployment

```dockerfile
# Dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install -g dexto
COPY . .
CMD ["dexto", "--mode", "web", "--web-port", "3000"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  researcher:
    build: .
    ports:
      - "3001:3000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - TAVILY_API_KEY=${TAVILY_API_KEY}
    command: dexto --mode mcp --web-port 3000 --agent researcher.yml
    
  writer:
    build: .
    ports:
      - "3002:3000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    command: dexto --mode web --web-port 3000 --agent writer.yml
    depends_on:
      - researcher
```

### 3. Load Balancing
Use nginx to load balance multiple instances:

```nginx
upstream researcher_agents {
    server localhost:3001;
    server localhost:3011;
    server localhost:3021;
}

server {
    listen 80;
    location /researcher/ {
        proxy_pass http://researcher_agents/;
    }
}
```

## Troubleshooting

### Common Issues

**"Connection refused" errors**
- Ensure the researcher agent is started before the writer
- Check that ports are not already in use: `netstat -tulpn | grep :3001`
- Verify the MCP endpoint URLs in configurations

**Timeout errors**
- Increase timeout values in MCP server configurations
- Check agent response times in the web UI
- Consider splitting complex tasks

**Tool not found errors**
- Verify agent names match the MCP server names
- Check that target agents are running
- Ensure MCP endpoints return proper responses

**Environment variable issues**
- Verify `.env` file is in the working directory
- Check API key validity and credits
- Use `--no-verbose` flag to reduce debug output

## Next Steps

- **Scale Up**: Add more specialized agents to your system
- **Production**: Use PM2, Docker, or Kubernetes for deployment
- **Integration**: Connect to external services and APIs
- **Monitoring**: Add health checks and logging

The beauty of Dexto's multi-agent systems is their simplicity - just configuration files and command-line arguments. No custom code, no complex deployments, just pure agent collaboration! 🤖✨ 