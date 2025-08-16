# Dexto + LangChain Integration Example

This example demonstrates how Dexto's orchestration layer can integrate existing agents from other frameworks (like LangChain, LangGraph, etc.) via the Model Context Protocol (MCP), enabling seamless multi-agent workflows.

## Architecture

```mermaid
graph TD
    A[Dexto Orchestrator] --> B[Filesystem Tools]
    A --> C[Puppeteer Tools]
    A --> D[LangChain MCP]
    
    D --> E[LangChain Agent]
    
    style A fill:#4f46e5,stroke:#312e81,stroke-width:2px,color:#fff
    style B fill:#10b981,stroke:#065f46,stroke-width:1px,color:#fff
    style C fill:#f59e0b,stroke:#92400e,stroke-width:1px,color:#fff
    style D fill:#8b5cf6,stroke:#5b21b6,stroke-width:1px,color:#fff
    style E fill:#6b7280,stroke:#374151,stroke-width:1px,color:#fff
```

## How to Think About Multi-Agent Integration

When building multi-agent systems, you often have agents built in different frameworks. Here's how to approach this with Dexto:

1. **Start with what you have**: You may already have agents in LangChain, LangGraph, AutoGen, or other frameworks
2. **Use MCP as the bridge**: Instead of rebuilding or creating custom adapters, wrap your existing agents with MCP as a tool
3. **Let Dexto orchestrate**: Dexto can then coordinate between your existing agents and other tools/subsystems
4. **Build incrementally**: Add more agents and frameworks as needed - MCP makes it straightforward

## Quick Setup

```bash
# Install dependencies
cd examples/dexto-langchain-integration/langchain-agent
npm install

# Set API key
export OPENAI_API_KEY="your_openai_api_key_here"

# Test integration
dexto --agent ./examples/dexto-langchain-integration/dexto-agent-with-langchain.yml "Solve: 2^10 + 15 * 3"
```

## What You Can Do

**Dexto orchestrates between:**
- **Filesystem**: Read/write files
- **Puppeteer**: Web browsing and interaction
- **LangChain Agent**: Math, text analysis, creative content

**Example workflows:**
```bash
# Math calculation
dexto --agent ./examples/dexto-langchain-integration/dexto-agent-with-langchain.yml "Solve: 2^10 + 15 * 3"

# Text analysis
dexto --agent ./examples/dexto-langchain-integration/dexto-agent-with-langchain.yml "Analyze this text: 'I love this product!'"

# Multi-step: Read file → Analyze with LangChain
dexto --agent ./examples/dexto-langchain-integration/dexto-agent-with-langchain.yml "Read README.md, then analyze its content."

# Complex: Web scrape → LangChain analysis → Save report
dexto --agent ./examples/dexto-langchain-integration/dexto-agent-with-langchain.yml "Search web for AI trends, analyze with LangChain Agent, save report"
```

## How It Works

1. **Dexto Orchestrator**: Manages & supervises all subsystems and workflows
2. **LangChain MCP Agent**: Wraps existing LangChain agent as a Dexto subsystem
3. **Configuration**: Registers LangChain alongside filesystem and puppeteer tools

## Extending

**Add agents from other frameworks:**
1. Wrap more agents into an MCP Server
2. Add to Dexto configuration
3. Dexto orchestrates between all agents and subsystems

**Add capabilities to existing agents:**
1. Extend your external agent capabilities
2. Register new tools/methods
3. Dexto accesses via MCP integration

This demonstrates how to think about Dexto as your orchestration layer for multi-agent systems - start with your existing agents, use MCP to connect them, and let Dexto handle the coordination.
