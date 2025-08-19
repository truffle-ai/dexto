---
sidebar_position: 2

---

# CLI Guide

This guide helps you get started with the Dexto CLI and includes a comprehensive list of commands you can run with Dexto CLI.

Dexto CLI is the easiest way to get started with AI agents.

Some of the cool things you can do with Dexto CLI:

- Talk to any LLM in your terminal
- Create long-lived AI agents with tools, knowledge and memories. Example: a productivity agent that integrates with your linear and github.
- Deploy these agents either locally or on the cloud
- Talk to these agents on any application - discord, telegram, slack, cursor, claude desktop, etc.
- Start building your own AI applications - get started with building your own Cursor! `dexto create-app`


More CLI commands coming soon! 

Request a CLI command by creating an issue [here](https://github.com/truffle-ai/dexto/issues).


#### **See all available options and flags:**

```bash
dexto -h
```

#### **Launch the interactive CLI:**
```bash
dexto
```

#### **Start dexto CLI with a different LLM**
```bash
# openai
dexto -m gpt-4o

# anthropic
dexto -m claude-4-sonnet-20250514

# google
dexto -m gemini-2.0-flash
```


#### **Start dexto with a different config file**

This allows you to configure dexto CLI to use a different AI agent
```bash
dexto --agent <path_to_agent_config_file>
```

Check [Configuration Guide](./configuring-dexto/overview) to understand more about dexto config files

#### **Require all MCP servers to connect successfully**

By default, Dexto uses "lenient" mode where individual servers can fail to connect without preventing startup. Use the `--strict` flag to require all servers to connect successfully:

```bash
dexto --strict
```

This overrides any individual `connectionMode` settings in your MCP server configurations. See [MCP Configuration](../mcp/connecting-servers) for more details on connection modes.

#### **Run a specific command with Dexto CLI:**

```bash
dexto "find all .sh files in this directory"
# or use explicit -p flag
dexto -p "find all .sh files in this directory"
```

or do the same with gemini:

```bash
dexto -m gemini-2.0-flash "find all files in this directory"
# or with explicit -p flag
dexto -m gemini-2.0-flash -p "find all files in this directory"
```

Dexto CLI can accept __any__ command - if it doesn't see it as an in-built command, it will fire a single run CLI with that request

For instance, in the above command, the query "find all .sh files in this directory" will start Dexto Agent, send it this query, process the response, and then exit.


#### **Start a telegram bot**

```bash
dexto --mode telegram
```
To use a specific agent config file for the telegram bot:
```bash
dexto --mode telegram --agent ./telegram-agent-config.yml
```

<!-- Todo: add telegram demo -->

#### **Start a discord bot**
```bash
dexto --mode discord
```
To use a specific agent config file for the discord bot:
```bash
dexto --mode discord --agent ./discord-agent-config.yml
```

<!-- Todo: add discord demo -->

#### **Start dexto as an MCP server**
```bash
dexto --mode mcp
```

With this, you can now connect this agent to Cursor, claude desktop, or even other Dexto agents!

Check [Using dexto as an MCP Server](../mcp/dexto-as-mcp-server) to understand more about MCP servers.

#### **Group MCP servers with dexto**
```bash
dexto mcp --group-servers
```

This starts Dexto as an MCP server that aggregates and re-exposes tools from multiple configured MCP servers. This is useful when you want to access tools from multiple MCP servers through a single connection.

To use a specific config file:
```bash
dexto mcp --group-servers -a ./dexto-tools.yml
```

Check [Using Dexto to group MCP servers](../mcp/grouping-servers) to understand more about MCP server aggregation.


#### **Change log level for dexto CLI**

To change the logging level, set environment variable `DEXTO_LOG_LEVEL` to 'info', 'debug', or 'silly'. Default is 'info'.

ex: for debug logs:
```bash
DEXTO_LOG_LEVEL=debug
dexto what is the time
```


## Project setup commands

These commands will help you get started creating your own AI application using Dexto

Setup a fresh typescript project using dexto-core
```bash
dexto create-app
```

Add dexto into an existing typescript project
```bash
dexto init-app
```

Check [Building with Dexto Guide](../tutorials/index.md) for more information!

## Coming soon!

Some of the CLI commands we're working on!

#### Load pre-built templates for dexto CLI

#### Deploy config files as AI agents with dexto CLI
