---
title: "Coding Agent: Create Apps on Demand"
---

# Coding Agent: Create Apps on Demand

Build full-stack applications, websites, and interactive games with AI-powered coding agents.

**Task:** `Can you create a snake game in a new folder and open it when done?`

```bash
dexto --agent coding-agent "Can you create a snake game in a new folder and open it when done?"
```

<img src="/assets/coding_agent_demo.gif" alt="Snake Game Development Demo" width="600"/>

## What it does

The Coding Agent can:
- Generate complete applications from natural language descriptions
- Write HTML, CSS, JavaScript, TypeScript, and more
- Create interactive games and websites
- Automatically open finished projects in the browser
- Refactor and debug existing code

## Requirements

- Anthropic Claude Haiku 4.5 (included in agent config)
- Filesystem and browser tools (included)

## Try it

```bash
# Install the agent
dexto install coding-agent

# Create a game
dexto --agent coding-agent "create a snake game in HTML/CSS/JS, then open it in the browser"

# Build a website
dexto --agent coding-agent "create a landing page for a coffee brand inspired by star wars"

# Or use the default agent
dexto "create a to-do list app with local storage"
```

The agent will:
1. Create project files and folders
2. Write the code
3. Open the finished app in your browser

## Supported Languages

50+ programming languages and config formats including:
- HTML, CSS, JavaScript, TypeScript
- Python, Go, Rust
- React, Vue, Svelte
- And more
