# Discord Bot Example

This is a **reference implementation** showing how to integrate DextoAgent with Discord using discord.js. It demonstrates:
- Connecting to Discord's WebSocket API
- Processing messages and commands
- Handling image attachments
- Managing per-user conversation sessions
- Integrating tool calls with Discord messages

## ⚠️ Important: This is a Reference Implementation

This example is provided to show how to build Discord integrations with Dexto. While it works, it's not a production-ready bot and may lack:
- Advanced error recovery and retry logic
- Comprehensive logging and monitoring
- Scalability features for large deployments
- Advanced permission management

Use this as a foundation to build your own customized Discord bot!

## Quick Start

### 1. Get Your Discord Bot Token

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. In the sidebar, navigate to **Bot** → Click **Add Bot**
4. Under the TOKEN section, click **Copy** (or **Reset Token** if you need a new one)
5. Save this token - you'll need it in the next step

### 2. Set Up Your Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` and add:

1. **Your Discord Bot Token** (required):
   ```
   DISCORD_BOT_TOKEN=your_token_here
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

### 3. Invite Bot to Your Server

1. In Developer Portal, go to **OAuth2** → **URL Generator**
2. Select scopes: `bot`
3. Select permissions: `Send Messages`, `Read Messages`, `Read Message History`, `Attach Files`
4. Copy the generated URL and visit it to invite your bot to your server

### 4. Install Dependencies

Install the required dependencies:

```bash
pnpm install
```

### 5. Run the Bot

Start the bot:

```bash
pnpm start
```

You should see:
```
🚀 Initializing Discord bot...
Discord bot logged in as YourBotName#1234
✅ Discord bot is running!
```

## Usage

### In DMs
Simply send a message to the bot - it will respond using the configured LLM.

### In Server Channels
Use the `!ask` prefix:
```
!ask What is the capital of France?
```

The bot will respond with the agent's response, splitting long messages to respect Discord's 2000-character limit.

### Image Support
Send an image attachment with or without text, and the bot will process it using the agent's vision capabilities.

### Audio Support
Send audio files (MP3, WAV, OGG, etc.), and the bot will:
- Transcribe the audio (if model supports speech recognition)
- Analyze the audio content
- Use audio as context for responses

Simply attach an audio file to your message and the bot will process it using the agent's multimodal capabilities.

### Reset Conversation
To start a fresh conversation session, DM the bot with:
```
/reset
```

## Configuration

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

- **`DISCORD_BOT_TOKEN`** (Required): Your bot's authentication token
- **`OPENAI_API_KEY`** (Required for OpenAI): Your OpenAI API key
- **`ANTHROPIC_API_KEY`** (Optional): For using Claude models
- **`GOOGLE_GENERATIVE_AI_API_KEY`** (Optional): For using Gemini models
- **`DISCORD_RATE_LIMIT_ENABLED`** (Optional): Enable/disable rate limiting (default: true)
- **`DISCORD_RATE_LIMIT_SECONDS`** (Optional): Cooldown between messages per user (default: 5)

## Features

### Rate Limiting
By default, the bot enforces a 5-second cooldown per user to prevent spam. Adjust or disable via environment variables.

### Tool Notifications
When the LLM calls a tool (e.g., making an API call), the bot sends a notification message so users can see what's happening:
```
🔧 Calling tool get_weather with args: {...}
```

### Session Management
Each Discord user gets their own persistent conversation session during the bot's lifetime. Messages from different users don't interfere with each other.

### Large Responses
Responses longer than Discord's 2000-character limit are automatically split into multiple messages.

## Limitations

- **No persistence across restarts**: Sessions are lost when the bot restarts. For persistent sessions, implement a database layer.
- **Simple message handling**: Only responds to text and images. Doesn't support all Discord features like reactions, threads, etc.
- **Per-deployment limits**: The bot runs as a single instance. For horizontal scaling, implement clustering.

## Architecture

```
Discord Message
    ↓
startDiscordBot() wires up event handlers
    ↓
agent.generate() processes the message
    ↓
Response sent back to Discord
    ↓
agentEventBus emits events (tool calls, etc.)
    ↓
Tool notifications sent to channel
```

## Troubleshooting

### Bot doesn't respond to messages
- Check that the bot has permission to send messages in the channel
- Ensure `DISCORD_BOT_TOKEN` is correct in `.env`
- Verify bot has `Message Content Intent` enabled in Developer Portal

### "DISCORD_BOT_TOKEN is not set"
- Check that `.env` file exists in the example directory
- Verify the token is correctly copied from Developer Portal

### Rate limiting errors
- Check `DISCORD_RATE_LIMIT_SECONDS` setting
- Set `DISCORD_RATE_LIMIT_ENABLED=false` to disable rate limiting

### Image processing fails
- Ensure attachments are under 5MB
- Check network connectivity for downloading attachments

## Next Steps

To customize this bot:

1. **Modify `agent-config.yml`**:
   - Change the LLM provider/model
   - Add MCP servers for additional capabilities
   - Customize the system prompt

2. **Extend `bot.ts`**:
   - Add new command handlers
   - Implement additional Discord features
   - Add logging/monitoring

3. **Deploy**:
   - Run on a server/VPS that stays online 24/7
   - Use process managers like PM2 to auto-restart on crashes
   - Consider hosting on platforms like Railway, Heroku, or AWS

## Documentation

- [Discord.js Documentation](https://discord.js.org/)
- [Discord Developer Portal](https://discord.com/developers/applications)
- [Dexto Documentation](https://dexto.dev)
- [Dexto Agent API](https://docs.dexto.dev)

## License

MIT
