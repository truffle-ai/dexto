---
sidebar_position: 4
sidebar_label: "What are Tools?"
---

# Tools

## The Role of Tools

 **Tools** are external services, APIs, or modules that an AI agent can use to perform actions, retrieve information, or manipulate data.

### Why Tools Matter

AI agents are powerful because they can go beyond language understanding—they can take real actions in the world. Tools are the bridge between the agent's reasoning and real-world effects.

### How do Dexto Agents use Tools?
Dexto agents use tools from MCP servers - MCP servers define the tools, dexto uses them.

### Examples of Tools in Dexto

- **Filesystem Tool:** Read, write, or search files on your computer.
- **Web Browser Tool:** Automate web browsing, scraping, or form submissions.
- **Email Tool:** Read, summarize, or send emails.
- **Slack Tool:** Post messages, retrieve channels, or automate notifications.
- **Custom Tools:** Any API or service you connect via the Model Context Protocol (MCP).

### How Tools Work

- Tools are registered with Dexto agents via MCP configuration (see the Configuration docs).
- When you give a natural language command, the agent decides which tools to use and in what order.
- The agent can chain multiple tools together to accomplish complex tasks.

**Example:**
> "Find all PDF files in my Downloads folder and email them to me."

- The Dexto agent uses the Filesystem Tool to search for PDFs.
- Then uses the Email Tool to send them—all automatically.

### Extending with Your Own Tools

Dexto agents are extensible: you can add your own tools by implementing an MCP server or connecting to existing APIs. This lets you automate anything you can describe and connect. 