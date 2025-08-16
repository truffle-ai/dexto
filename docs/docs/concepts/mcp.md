---
sidebar_position: 5
---

# What is MCP (Model Context Protocol)?

The **Model Context Protocol (MCP)** is an open protocol created and maintained by Anthropic - [MCP github organization](https://github.com/modelcontextprotocol)

MCP defines how AI agents (like Dexto agents) can discover, connect to, and interact with external tools, services, and APIs in a standardized way.

## Why MCP Matters

- **Interoperability:** MCP provides a common language for agents and tools, making it easy to connect new services without custom integration code for each one.
- **Extensibility:** Anyone can build and share MCP-compatible tools, expanding what agents can do.
- **Modularity:** Tools are decoupled from the agent's core logic, so you can add, remove, or swap tools as needed.

## How Dexto Agents Use MCP

Dexto agents use MCP to:
- **Discover available tools:** MCP servers advertise what actions they support (e.g., read a file, send an email, browse the web).
- **Connect to tools:** Dexto agents communicate with MCP servers using a standard protocol (often over stdio, HTTP, or sockets).
- **Invoke tool actions:** When you give a command, Dexto selects the right tool(s) via MCP and orchestrates their use to fulfill your request.
- **Read server resources:** Dexto agents can read resources from the server, like files, databases, etc., and use that to reason about what to do next.

## Example: Registering a Tool via MCP

Suppose you want to add a filesystem tool. In your Dexto agent configuration file, you might specify:

```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args:
      - -y
      - "@modelcontextprotocol/server-filesystem"
      - .
    connectionMode: strict  # Ensure this tool is always available
```

This tells your Dexto agent to connect to the filesystem MCP server, which then advertises its capabilities to the agent.

## Learn More

- [Model Context Protocol documentation](https://modelcontextprotocol.io/introduction)
- [MCP reference servers on GitHub](https://github.com/modelcontextprotocol/reference-servers)

MCP is a key part of what makes Dexto flexible, extensible, and able to automate across a wide range of tools and services. 