# Discord Bot Setup

To run Dexto as a Discord bot, you need to configure the following environment variable:

1.  **`DISCORD_BOT_TOKEN` (Required)**
    *   This is the authentication token for your Discord bot application. It allows your Dexto instance to connect to Discord as your bot.
    *   **How to get your token:**
        1.  Go to the [Discord Developer Portal](https://discord.com/developers/applications).
        2.  Select your application, or create a new one if you haven't already.
        3.  In the sidebar, navigate to **Bot**.
        4.  Under the "Token" section, click **Reset Token** (or **Copy Token** if one is already generated and visible).
        5.  Confirm the reset if prompted (this will invalidate the old token if one existed).
        6.  Copy the newly revealed token. This is your `DISCORD_BOT_TOKEN`.
            *   **Important:** Treat this token like a password. Do not share it publicly or commit it to your repository.
    *   Example (in your `.env` file):
        `DISCORD_BOT_TOKEN=YOUR_DISCORD_BOT_TOKEN_HERE`

## Running the Bot

Once the `DISCORD_BOT_TOKEN` is set (e.g., in a `.env` file at the project root), you can start the Discord bot.

To use the default Dexto configuration (`agents/agent.yml`):
```bash
dexto --mode discord
# With a custom config path:
# dexto --mode discord --agent ./agents/discord_bot_config.yml
```

Or, if you are running directly from the source without a global installation:
```bash
npm start -- --mode discord
# With a custom config path:
# npm start -- --mode discord --agent ./agents/discord_bot_config.yml
```

Refer to the main project [README.md](../../../README.md) for more details on general Dexto setup and configuration.

## Technical Details

*   **Message Handling:** The bot connects to Discord using a WebSocket and processes messages as they arrive based on `discord.js` library events. It does not use explicit short polling for messages.
*   **Service Initialization:** When started, the Discord bot initializes its own instance of Dexto's core services (LLM service, client manager for MCP tools, event bus) by calling `createAgentServices`. It uses `runMode: 'web'` for this initialization. This means that, by default, tool confirmations use the `NoOpConfirmationProvider`, which automatically approves all tool executions initiated by the bot.
*   **Configuration:** The Dexto configuration file (specified by `DISCORD_CONFIG_PATH`, the global `--agent` option, or the default `agents/agent.yml`) is loaded by the bot to configure its internal services, such as the LLM provider, model, and any MCP server connections.
*   **Tool Call Notifications:** The bot subscribes to `llmservice:toolCall` events on its `agentEventBus`. When a tool is about to be executed by the LLM service, a notification message (⚙️ Calling tool...) is sent to the Discord channel where the command originated.
*   **Image Attachments:** If a message includes an image attachment, the bot downloads the image, converts it to a base64 string, and passes it along with any text content to the LLM service for processing. This allows for multimodal interactions.
*   **Command Trigger:** The bot responds to messages in Direct Messages (DMs) or messages in servers/guilds that start with the `!ask ` prefix. 