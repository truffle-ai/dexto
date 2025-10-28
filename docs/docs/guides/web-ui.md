---
sidebar_position: 4
title: "Web UI Guide"
---

# Web UI

## Overview

Dexto web UI is the easiest way to test out different LLMs, MCP servers, prompts, and more!

Once you're satisfied with a specific combination, save it as a **Re-usable** AI agent built with Dexto, and deploy the agent anywhere.

All this is possible because Dexto sees any valid config file as a re-usable AI agent.

Dexto web UI also stores your conversation history locally so it remembers your past conversations!

## Get started
**Start dexto web UI:**

```bash
dexto
```
This opens the Web UI at [http://localhost:3000](http://localhost:3000) in your browser (web is the default mode).

The API server runs on port 3001 (web port + 1).

**Use a different port:**

```bash
dexto --web-port 3333
```

This starts the Web UI on port 3333, with the API server on port 3334.

**Customize API port independently:**

```bash
dexto --web-port 3333 --api-port 8080
```

This is useful for custom port configurations or when integrating with existing infrastructure.

## Conversation storage

When installed as a global CLI, dexto stores conversation history in `~/.dexto` folder by default

In development mode, storage location defaults to`<path_to_dexto_project_dir>/.dexto`