---
sidebar_position: 4
---

# Tools

## The Role of Tools

 **Tools** are external services, APIs, or modules that an AI agent can use to perform actions, retrieve information, or manipulate data.

### Why Tools Matter

AI agents are powerful because they can go beyond language understanding—they can take real actions in the world. Tools are the bridge between the agent's reasoning and real-world effects.

### Examples of Tools in Saiki

- **Filesystem Tool:** Read, write, or search files on your computer.
- **Web Browser Tool:** Automate web browsing, scraping, or form submissions.
- **Email Tool:** Read, summarize, or send emails.
- **Slack Tool:** Post messages, retrieve channels, or automate notifications.
- **Custom Tools:** Any API or service you connect via the Model Context Protocol (MCP).

### How Tools Work

- Tools are registered with Saiki agents via configuration (see the Configuration docs).
- When you give a natural language command, the agent decides which tools to use and in what order.
- The agent can chain multiple tools together to accomplish complex tasks.

**Example:**
> "Find all PDF files in my Downloads folder and email them to me."

- The Saiki agent uses the Filesystem Tool to search for PDFs.
- Then uses the Email Tool to send them—all automatically.

### Extending with Your Own Tools

Saiki agents are extensible: you can add your own tools by implementing an MCP server or connecting to existing APIs. This lets you automate anything you can describe and connect. 