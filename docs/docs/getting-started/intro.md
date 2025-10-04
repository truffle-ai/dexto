---
sidebar_position: 1
---

# Introduction

Dexto is an agent orchestration engine that connects your existing systems to language models, creating AI assistants that can actually use your tools, databases, and APIs.

Instead of building AI applications from scratch, you connect what you already have—databases, APIs, development tools, business systems—and Dexto handles the orchestration. Users interact with everything through natural language, while Dexto manages the complexity of state, tool calling, and conversation context.

This means you can turn any system into an intelligent assistant without writing custom integration code or managing LLM interactions yourself.

## The Problem

Your systems require technical knowledge to use:
- Databases need SQL queries
- APIs need code integration  
- Tools need manual operation
- Services don't communicate with each other

Building AI assistants that can actually use these systems requires managing state, tool calling, service coordination, and conversation context.

## The Solution

Dexto handles the orchestration:

1. **Connect your systems** via Model Context Protocol (MCP)
2. **Define agent behavior** in a YAML configuration
3. **Users interact** through natural language

Dexto manages:
- Converting natural language to system actions
- Coordinating multiple tools and services
- Maintaining conversation state and context
- Error handling and retries

## What You Can Build

Connect any system to create AI assistants:
- **Databases** → Query with natural language
- **APIs** → Control through conversation
- **Development tools** → AI coding assistants
- **Business systems** → Automated workflows
- **Web services** → Browser automation
- **File systems** → Document management

import ExpandableImage from '@site/src/components/ExpandableImage';

<ExpandableImage 
  src="/assets/intro_diagram.png" 
  alt="Dexto Architecture" 
  title="Dexto Architecture Overview"
/>

## How to Use Dexto

1. **Install**: `npm install -g dexto`
2. **Configure**: Create an `agent.yml` file with your systems and LLM
3. **Run**: `dexto --agent agent.yml`

## Key Features

- **20+ LLM providers** - OpenAI, Anthropic, Google, Groq, local models
- **MCP integration** - Connect to 100+ tools and services
- **Multiple interfaces** - CLI, Web UI, REST API, SDK
- **Persistent sessions** - Maintain context across conversations
- **Local-first** - Run on your infrastructure
- **Production storage** - Redis, PostgreSQL, SQLite

## Ready to Get Started?

**[Install Dexto →](./installation.md)**

---

*Dexto is built by the team at Truffle AI. Join our community and help shape the future of intelligent agent orchestration!* 