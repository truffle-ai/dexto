---
sidebar_position: 1
title: "Dexto Agent SDK"
---

# Building with the Dexto Agent SDK

Learn to build production-ready AI agents with the Dexto SDK. These tutorials follow a progressive path—each one builds on the previous, adding one core concept at a time.

## Tutorial Path

Follow these in order for the best learning experience:

### 1. [Quick Start](./quick-start.md)
**Get your first AI response in 5 minutes.**

The minimal working example. No explanations, no complexity—just 15 lines of code that prove the SDK works. Once you see a response, you know you're set up correctly.

### 2. [Working with Sessions](./sessions.md)
**Give your agent memory.**

Right now your agent forgets everything after each response. Sessions let agents remember previous messages—the foundation for real conversations. Learn when to create sessions, how to manage them, and common patterns for different use cases.

### 3. [Multi-User Chat Endpoint](./multi-user-chat.md)
**Serve hundreds of users with one agent.**

Building a new agent for each user wastes resources. Learn the production pattern: one shared agent, multiple sessions, isolated conversations. Includes a complete Express server example with proper session management.

### 4. [Adding Tools](./tools.md)
**Turn your agent from a chatbot into an actor.**

LLMs only generate text—they can't read files, search the web, or query databases. Tools change that. Learn to add pre-built MCP servers, manage tools dynamically based on user permissions, and build custom tools for your specific needs.

### 5. [Handling Events](./events.md)
**Build responsive, production-quality UIs.**

Without events, your UI is blind—users see nothing while waiting for responses. Events let you show loading states, stream text in real-time, display tool usage, and handle errors gracefully. Includes complete SSE examples.

### 6. [Loading Agent Configs](./config-files.md)
**Move from inline configs to production-ready YAML files.**

You've been configuring agents inline with JavaScript objects. That works for demos, but production apps need reusable, shareable configs. Learn to load agent configs from YAML files, understand config enrichment, and manage multi-environment setups—the same pattern used by Dexto's built-in agents.

### 7. [Agent Orchestration](./orchestration.md)
**Manage multiple agents programmatically.**

So far you've worked with one agent at a time. But what if you're building a platform where users choose from specialized agents? Learn to use AgentManager to list, install, and manage multiple agents programmatically—build agent marketplaces, multi-tenant systems, and dynamic agent selection.

### 8. [System Prompt Preparation](./context-management/prompt-contributors.md)
**Build modular, maintainable system prompts.**

A giant system prompt string becomes a maintenance nightmare. Learn to compose prompts from multiple sources—static text, external files, and runtime content—each handling one piece of the puzzle.

## What You'll Build

By the end of these tutorials, you'll have:
- ✅ A working agent that can use multiple LLM providers
- ✅ Conversation memory across multiple turns
- ✅ Multi-user support with isolated sessions
- ✅ Real-world capabilities (file access, web search, databases)
- ✅ A responsive UI with streaming and progress indicators
- ✅ Production-ready config management with YAML files
- ✅ Programmatic agent orchestration and management
- ✅ Modular system prompts from multiple sources

## API Reference

Once you've completed the tutorials, dive deeper with the API docs:

- **[DextoAgent API](/api/sdk/dexto-agent)** - Complete method documentation
- **[Events Reference](/api/sdk/events)** - All available events and payloads
- **[Types Reference](/api/sdk/types)** - TypeScript type definitions

Ready to start? **[Begin with Quick Start →](./quick-start.md)**
