---
sidebar_position: 2
---

# Web playground 

## Overview

Dexto web playground is the easiest way to test out different LLMs, MCP servers, prompts, and more!

Once you're satisfied with a specific combination, save it as a **Re-usable** AI agent built with Dexto, and deploy the agent anywhere.

All this is possible because Dexto sees any valid config file as a re-usable AI agent.

Dexto web playground also stores your conversation history locally so it remembers your past conversations!

## Get started
**Start dexto web playground:**

```bash
dexto --mode web
```
Then open [http://localhost:3000](http://localhost:3000) in your browser.

Or open dexto web playground in a different port:

```bash
dexto --mode web --web-port 3333
```

## Conversation storage

When installed as a global CLI, dexto stores conversation history in `~/.dexto` folder by default

In development mode, storage location defaults to`<path_to_dexto_project_dir>/.dexto`