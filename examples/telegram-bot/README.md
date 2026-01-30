# Telegram Bot Example

This is a **reference implementation** showing how to integrate DextoAgent with Telegram using grammy. It demonstrates:
- Connecting to Telegram Bot API with long polling
- Processing messages and commands
- Handling inline queries for direct responses in any chat
- Handling image attachments
- Managing per-user conversation sessions
- Integrating tool calls with Telegram messages

## ⚠️ Important: This is a Reference Implementation

This example is provided to show how to build Telegram integrations with Dexto. While it works, it's not a production-ready bot and may lack:
- Advanced error recovery and retry logic
- Comprehensive logging and monitoring
- Scalability features for large deployments
- Webhook support (currently uses long polling only)
- Advanced rate limiting

Use this as a foundation to build your own customized Telegram bot!

## Quick Start

### 1. Get Your Telegram Bot Token

1. Open Telegram and search for **BotFather** (verify it has the blue checkmark)
2. Send `/start` to begin a conversation
3. Send `/newbot` to create a new bot
4. Follow the prompts:
   - Give your bot a name (e.g., "Dexto AI Bot")
   - Give it a username ending in "bot" (e.g., "dexto_ai_bot")
5. BotFather will provide your token - save it for the next step

### 2. Set Up Your Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` and add:

1. **Your Telegram Bot Token** (required):
   ```
   TELEGRAM_BOT_TOKEN=your_token_here
   ```

2. **Your LLM API Key** (required):

   For OpenAI (default):
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   ```

   Or use a different provider and update `agent-config.yml`:
   ```
   # ANTHROPIC_API_KEY=your_key_here
   # GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
   ```

**Get API Keys:**
- **OpenAI**: https://platform.openai.com/account/api-keys
- **Anthropic**: https://console.anthropic.com/account/keys
- **Google**: https://ai.google.dev

### 3. Install Dependencies

Install the required dependencies:

```bash
pnpm install
```

### 4. Run the Bot

Start the bot:

```bash
pnpm start
```

You should see:
```
🚀 Initializing Telegram bot...
📡 Starting Telegram bot connection...
✅ Telegram bot is running! Start with /start command.
```

### 5. Test Your Bot

1. Open Telegram and search for your bot's username
2. Click "Start" or send `/start` command
3. You should see a welcome message with buttons

## Usage

### Commands

- **`/start`** - Display welcome message with command buttons and options
- **`/ask <question>`** - Ask a question (works in groups with prefix)
- **`/explain <topic>`** - Get detailed explanations of topics
- **`/summarize <text>`** - Summarize provided content
- **`/code <problem>`** - Get help with programming tasks
- **`/analyze <data>`** - Analyze information or data
- **`/creative <idea>`** - Brainstorm creatively on a topic

### Features

#### Quick Command Buttons
When you send `/start`, the bot displays interactive buttons for each command. Click a button to start that interaction without typing a command!

**Available command buttons:**
- 💡 Explain
- 📋 Summarize
- 💻 Code
- ✨ Creative
- 🔍 Analyze

#### Text Messages
Send any message directly to the bot in DMs, and it will respond using the configured LLM with full conversation context.

#### Image Support
Send photos with optional captions, and the bot will analyze them using the agent's vision capabilities (for models that support vision).

#### Audio/Voice Messages
Send voice messages or audio files, and the bot will:
- Transcribe the audio (if model supports speech recognition)
- Analyze the audio content
- Use voice as context for responses

Supported audio formats: OGG (Telegram voice), MP3, WAV, and other audio formats your LLM supports.

#### Inline Queries
In any chat (without messaging the bot), use inline mode:
```
@your_bot_name What is the capital of France?
```
The bot will respond with a result you can send directly to the chat.

#### Session Management
- **Reset Conversation** - Use the 🔄 Reset button from `/start` to clear conversation history
- **Help** - Use the ❓ Help button to see all available features

#### Per-User Sessions
Each Telegram user gets their own isolated conversation session. Multiple users in a group chat will each have separate conversations, preventing cross-user context pollution.

## Configuration

### Adding Custom Prompts

The bot automatically loads prompts from your `agent-config.yml` file. These prompts appear as buttons in `/start` and can be invoked as slash commands.

**To add a new prompt:**

```yaml
prompts:
  - type: inline
    id: mycommand       # Used as /mycommand
    title: "🎯 My Command"  # Button label
    description: "What this command does"
    prompt: "System instruction:\n\n{{context}}"  # Template with {{context}} placeholder
    category: custom
    priority: 10
```

**Example prompts included:**

*Self-contained (execute immediately):*
- `/quick-start` - Learn what the bot can do
- `/demo` - See tools in action

*Context-requiring (ask for input):*
- `/summarize` - Summarize content
- `/explain` - Detailed explanations
- `/code` - Programming help
- `/translate` - Language translation

**Using prompts:**
1. **As slash commands**: `/summarize Your text here`
2. **As buttons**:
   - Self-contained prompts execute immediately ⚡
   - Context-requiring prompts ask for input 💬
3. **Smart detection**: Bot automatically determines if context is needed
4. **Dynamic loading**: Prompts update when you restart the bot

### Switching LLM Providers

The bot comes configured with OpenAI by default. To use a different provider:

1. **Update `agent-config.yml`** - Change the `llm` section:

   ```yaml
   # For Anthropic Claude:
   llm:
     provider: anthropic
     model: claude-sonnet-4-5-20250929
     apiKey: $ANTHROPIC_API_KEY

   # For Google Gemini:
   llm:
     provider: google
     model: gemini-2.0-flash
     apiKey: $GOOGLE_GENERATIVE_AI_API_KEY
   ```

2. **Set the API key in `.env`**:
   ```
   ANTHROPIC_API_KEY=your_key_here
   # or
   GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
   ```

### Environment Variables

Create a `.env` file with:

- **`TELEGRAM_BOT_TOKEN`** (Required): Your bot's authentication token from BotFather
- **`OPENAI_API_KEY`** (Required for OpenAI): Your OpenAI API key
- **`ANTHROPIC_API_KEY`** (Optional): For using Claude models
- **`GOOGLE_GENERATIVE_AI_API_KEY`** (Optional): For using Gemini models
- **`TELEGRAM_INLINE_QUERY_CONCURRENCY`** (Optional): Max concurrent inline queries (default: 5)

## Features

### Session Management
Each Telegram user gets their own persistent conversation session during the bot's lifetime. Messages from different users don't interfere with each other.

### Tool Notifications
When the LLM calls a tool (e.g., making an API call), the bot sends a notification message so users can see what's happening:
```
Calling get_weather with args: {...}
```

### Inline Query Debouncing
Repeated inline queries are cached for 2 seconds to reduce redundant processing.

### Concurrency Control
By default, the bot limits concurrent inline query processing to 5 to prevent overwhelming the system. Adjust via `TELEGRAM_INLINE_QUERY_CONCURRENCY`.

## Architecture

```
Telegram Message
    ↓
startTelegramBot() wires up event handlers
    ↓
agent.run() processes the message
    ↓
Response sent back to Telegram
    ↓
agentEventBus emits events (tool calls, etc.)
    ↓
Tool notifications sent to chat
```

## Transport Methods

### Long Polling (Current)
The bot uses long polling by default. It continuously asks Telegram "any new messages?" This is:
- ✅ Simpler to implement
- ✅ Works behind firewalls
- ❌ More network overhead
- ❌ Slightly higher latency

### Webhook (Optional)
For production use, consider implementing webhook support for better performance. This would require:
- A public URL with HTTPS
- Updating grammy configuration
- Setting up a reverse proxy if needed

## Limitations

- **No persistence across restarts**: Sessions are lost when the bot restarts. For persistent sessions, implement a database layer.
- **Long polling**: Not ideal for high-volume bots. Consider webhooks for production.
- **Per-deployment limits**: The bot runs as a single instance. For horizontal scaling, implement clustering with a distributed session store.
- **No button callbacks for advanced features**: This example shows basic callback handling. Extend for more complex interactions.

## Troubleshooting

### Bot doesn't respond to messages
- Verify `TELEGRAM_BOT_TOKEN` is correct in `.env`
- Check that the bot is online by sending `/start` to BotFather
- Ensure the bot is running (`npm start`)

### "TELEGRAM_BOT_TOKEN is not set"
- Check that `.env` file exists in the example directory
- Verify the token is correctly copied from BotFather

### Timeout on inline queries
- Check `TELEGRAM_INLINE_QUERY_CONCURRENCY` setting
- The bot has a 15-second timeout for inline queries - if your LLM is slow, increase this in bot.ts

### Image processing fails
- Ensure images are valid and not corrupted
- Check network connectivity for downloading images

## Next Steps

To customize this bot:

1. **Modify `agent-config.yml`**:
   - Change the LLM provider/model
   - Add MCP servers for additional capabilities
   - Customize the system prompt

2. **Extend `bot.ts`**:
   - Add more commands
   - Implement webhook support
   - Add logging/monitoring
   - Add database persistence

3. **Deploy**:
   - Run on a server/VPS that stays online 24/7
   - Use process managers like PM2 to auto-restart on crashes
   - Consider hosting on platforms like Railway, Heroku, or AWS
   - Migrate to webhook transport for better scalability

## Documentation

- [grammY Documentation](https://grammy.dev/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [BotFather Commands](https://core.telegram.org/bots#botfather)
- [Dexto Documentation](https://dexto.dev)
- [Dexto Agent API](https://docs.dexto.dev)

## License

MIT
