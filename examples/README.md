# Dexto Examples

This directory contains example code and configurations demonstrating how to use Dexto in various contexts.

## Code Examples

### Basic Agent Usage (`basic-agent-example.ts`)

The simplest example of how to use the Dexto Agent SDK. Shows:
- Creating an agent with minimal configuration
- Starting and stopping the agent
- Creating a session
- Using `generate()` for request/response interactions
- Token usage tracking

Run it with:
```bash
npx tsx basic-agent-example.ts
```

### LangChain Integration (`dexto-langchain-integration/`)

Shows how to integrate Dexto with LangChain, useful if you're already using LangChain in your project.

### Agent Manager (`agent-manager-example/`)

Demonstrates using the AgentManager API for managing multiple agents programmatically.

### Agent Delegation (`agent-delegation/`)

Shows a pattern for implementing a multi-agent coordinator/specialist architecture where one agent delegates tasks to specialized agents.

### Demo Server (`resources-demo-server/`)

A simple HTTP server example demonstrating Dexto's resource authorization flow.

## Agent Configuration Examples

See the `/agents/` directory for YAML configuration examples for different use cases.

## How to Use These Examples

1. **Copy an example** to your project or workspace
2. **Customize** the configuration for your needs
3. **Install dependencies** if it has a `package.json`
4. **Follow the README** for setup and running instructions

Each example is self-contained and can be run independently.

## Platform Integration Examples

These examples show how to integrate DextoAgent with different messaging platforms. They are **reference implementations** that you can customize and extend for your own use cases.

### Discord Bot (`discord-bot/`)

A complete Discord bot integration using discord.js and the Discord Gateway API.

**Features:**
- Responds to messages in DMs and server channels
- Support for the `!ask` command prefix in channels
- Image attachment processing
- Rate limiting per user
- Persistent per-user conversation sessions
- Tool call notifications

**Quick Start:**
```bash
cd discord-bot
pnpm install
cp .env.example .env
# Add your DISCORD_BOT_TOKEN to .env
pnpm start
```

**See:** [`discord-bot/README.md`](./discord-bot/README.md) for detailed setup and usage instructions.

### Telegram Bot (`telegram-bot/`)

A complete Telegram bot integration using grammy and the Telegram Bot API.

**Features:**
- Responds to messages in DMs and group chats
- Support for `/ask` command and `/start` menu
- Image attachment processing
- Inline query support (use bot username in any chat)
- Session reset button
- Concurrency control for inline queries
- Persistent per-user conversation sessions
- Tool call notifications

**Quick Start:**
```bash
cd telegram-bot
pnpm install
cp .env.example .env
# Add your TELEGRAM_BOT_TOKEN to .env
pnpm start
```

**See:** [`telegram-bot/README.md`](./telegram-bot/README.md) for detailed setup and usage instructions.

## Building Your Own Integration

To build your own platform integration:

1. **Start with a reference implementation** - Use `discord-bot` or `telegram-bot` as a template
2. **Adapt the bot.ts** - Replace platform-specific code with your target platform's SDK
3. **Keep the pattern** - Receive a pre-initialized DextoAgent and implement platform-specific I/O
4. **Reuse the config** - Use the same agent-config.yml pattern for configuration
5. **Add main.ts** - Create a standalone runner that initializes the agent and starts your bot

The key pattern is:
```typescript
export function startMyBot(agent: DextoAgent) {
    // Platform-specific setup
    // Use agent.run() to process user input
    // Use agent.on() to listen for events
    // Return your platform's client/connection object
}
```

## Documentation

- [Dexto Documentation](https://dexto.dev)
- [DextoAgent API](https://docs.dexto.dev)
- [Configuration Reference](../agents/examples/README.md)

## License

MIT
