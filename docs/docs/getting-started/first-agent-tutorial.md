---
sidebar_position: 3
---

# Build Your First Agent

Now that you have Dexto installed, let's build your first custom agent. This tutorial will guide you through creating an `agent.yml` file to define an agent with a unique personality and tools.

### 1. Create Your Agent Configuration
The heart of a Dexto agent is the `agent.yml` configuration file. This is where you declaratively define the agent's identity and capabilities.

Create a new directory for your project and add a basic configuration:

```bash
mkdir my-pirate-agent
cd my-pirate-agent
```

```yaml
# agent.yml
systemPrompt: |
  You are a helpful AI assistant.

llm:
  provider: openai
  model: gpt-4.1-mini
```

This basic configuration tells the runtime to use OpenAI's `gpt-4.1-mini` model with a simple system prompt.

### 2. Give Your Agent a Personality
Let's customize your agent by giving it a distinct personality. Modify the `systemPrompt` to create a pirate-themed agent:

```yaml
# agent.yml
systemPrompt: |
  Ahoy! Ye be chattin' with a pirate AI. Speak like a pirate in all yer responses, savvy?

llm:
  provider: openai
  model: gpt-4.1-mini
```

Now run your agent from inside the `my-pirate-agent` directory:

```bash
dexto --agent agent.yml "Who are you?"
```

Your agent should now respond like a pirate. You've just changed your agent's behavior through declarative configuration—no code required.

### 3. Add Tool Integration
A core feature of Dexto is connecting agents to external tools through the Model Context Protocol (MCP). Let's give your pirate agent web browsing capabilities.

Add the `puppeteer` tool to your configuration:

```yaml
# agent.yml
systemPrompt: |
  Ahoy! Ye be chattin' with a pirate AI. Speak like a pirate in all yer responses, savvy?

llm:
  provider: openai
  model: gpt-4.1-mini

mcpServers:
  puppeteer:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/puppeteer-server"]
```

The runtime will automatically handle tool installation and integration when you first run the agent.

### 4. Test Your Enhanced Agent
Start an interactive session with your enhanced agent:

```bash
dexto --agent agent.yml
```

Now ask it to use its new web browsing capability:
> `summarize the main points of the article at https://en.wikipedia.org/wiki/Piracy`

Your agent will use the puppeteer tool to visit the webpage, read the content, and provide a summary (in pirate voice, of course).

## Congratulations!
You've just built and customized your first AI agent using declarative configuration. You've learned how to:

- ✅ Define an agent with `agent.yml` configuration
- ✅ Customize agent behavior through system prompts  
- ✅ Integrate external tools via MCP servers
- ✅ Run and interact with your agent using the runtime

This is the fundamental development workflow with Dexto: configure declaratively, let the runtime handle orchestration, and focus on your agent's purpose rather than implementation details.

**Next Steps**: Explore adding more [tools](../concepts/tools.md) or building [multi-agent systems](../tutorials/multi-agent-systems.md).
