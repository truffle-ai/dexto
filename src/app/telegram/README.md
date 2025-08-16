# Telegram Bot Setup

To run Dexto as a Telegram bot, you need to configure the following environment variable:

1.  **`TELEGRAM_BOT_TOKEN` (Required)**
    *   This is the authentication token for your Telegram bot. It allows your Dexto instance to connect to Telegram as your bot.
    *   **How to get your token:**
        1.  Open Telegram and search for "BotFather" (it's an official bot from Telegram with a verified checkmark).
        2.  Start a chat with BotFather by sending `/start`.
        3.  To create a new bot, send `/newbot`. Follow the prompts to choose a name and username for your bot. The username must end in "bot" (e.g., `YourDextoBot`).
        4.  Alternatively, if you already have a bot, you can generate/regenerate a token by sending `/token` and selecting your bot.
        5.  Once your bot is created or selected, BotFather will provide you with an API token. This is your `TELEGRAM_BOT_TOKEN`.
            *   **Important:** Treat this token like a password. Do not share it publicly or commit it to your repository.
    *   Example (in your `.env` file):
        `TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN_HERE`

## Running the Bot

Once the `TELEGRAM_BOT_TOKEN` is set (e.g., in a `.env` file at the project root), you can start the Telegram bot.

To use the default Dexto configuration (`agents/agent.yml`):
```bash
dexto --mode telegram
# With a custom config path:
# dexto --mode telegram --agent ./agents/telegram_bot_config.yml
```

Or, if you are running directly from the source without a global installation:
```bash
npm start -- --mode telegram
# With a custom config path:
# npm start -- --mode telegram --agent ./agents/telegram_bot_config.yml
```

Refer to the main project [README.md](../../../README.md) for more details on general Dexto setup and configuration.

## Technical Details

*   **Framework:** The bot now uses [grammY](https://grammy.dev), a modern, secure, and lightweight Telegram Bot framework with excellent TypeScript support.
*   **Message Handling:** The bot uses long polling to receive updates from Telegram. grammY handles this automatically when `bot.start()` is called.
*   **Tool Call Notifications:** The bot subscribes to `llmservice:toolCall` events on its `agentEventBus`. When a tool is about to be executed by the LLM service, a notification message (⚙️ Calling tool...) is sent to the Telegram chat where the command originated.
*   **Image Attachments:** If a message includes a photo, the bot downloads the highest resolution version of the image, converts it to a base64 string, and passes it along with any caption text to the LLM service for processing.
*   **Command Triggers & Interaction:**
    *   `/start`: Displays a welcome message and inline buttons (e.g., for resetting conversation).
    *   Button Callbacks: Handles actions from inline buttons (e.g., `reset`, `help`).
    *   `/ask <question>`: Specifically for group chats to direct a question to the bot.
    *   General Messages: In direct messages (DMs) or if no other command handler matches, the bot processes the text (and any attached image) as input for the LLM.
    *   Inline Queries (@YourBotName): Supports Telegram inline queries, allowing users to get AI responses directly in any chat by typing the bot's username and their query.

## Migration Notes

This bot was recently migrated from `node-telegram-bot-api` to grammY to:
- Fix security vulnerabilities in the deprecated `request` package
- Improve performance and reduce dependencies
- Provide better TypeScript support
- Enable access to modern Telegram Bot API features

All functionality remains the same, but the underlying implementation is now more secure and maintainable. 