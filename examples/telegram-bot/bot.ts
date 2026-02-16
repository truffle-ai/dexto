#!/usr/bin/env node
import 'dotenv/config';
import { Bot, InlineKeyboard } from 'grammy';

// Type for inline query result article (matching what we create)
type InlineQueryResultArticle = {
    type: 'article';
    id: string;
    title: string;
    input_message_content: { message_text: string };
    description: string;
};
import * as https from 'https';
import { DextoAgent, logger } from '@dexto/core';

const token = process.env.TELEGRAM_BOT_TOKEN;

// Concurrency cap and debounce cache for inline queries
const MAX_CONCURRENT_INLINE_QUERIES = process.env.TELEGRAM_INLINE_QUERY_CONCURRENCY
    ? Number(process.env.TELEGRAM_INLINE_QUERY_CONCURRENCY)
    : 5;
let currentInlineQueries = 0;
const INLINE_QUERY_DEBOUNCE_INTERVAL = 2000; // ms
const INLINE_QUERY_CACHE_MAX_SIZE = 1000;
const inlineQueryCache: Record<string, { timestamp: number; results: InlineQueryResultArticle[] }> =
    {};

// Cleanup old cache entries to prevent unbounded growth
function cleanupInlineQueryCache(): void {
    const now = Date.now();
    const keys = Object.keys(inlineQueryCache);

    // Remove expired entries
    for (const key of keys) {
        if (now - inlineQueryCache[key]!.timestamp > INLINE_QUERY_DEBOUNCE_INTERVAL) {
            delete inlineQueryCache[key];
        }
    }

    // If still over limit, remove oldest entries
    const remainingKeys = Object.keys(inlineQueryCache);
    if (remainingKeys.length > INLINE_QUERY_CACHE_MAX_SIZE) {
        const sortedKeys = remainingKeys.sort(
            (a, b) => inlineQueryCache[a]!.timestamp - inlineQueryCache[b]!.timestamp
        );
        const toRemove = sortedKeys.slice(0, remainingKeys.length - INLINE_QUERY_CACHE_MAX_SIZE);
        for (const key of toRemove) {
            delete inlineQueryCache[key];
        }
    }
}

// Cache for prompts loaded from DextoAgent
let cachedPrompts: Record<string, import('@dexto/core').PromptInfo> = {};

// Helper to detect MIME type from file extension
function getMimeTypeFromPath(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        ogg: 'audio/ogg',
        mp3: 'audio/mpeg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
    };
    return mimeTypes[ext] || 'application/octet-stream';
}

// Helper to download a file URL and convert it to base64
async function downloadFileAsBase64(
    fileUrl: string,
    filePath?: string
): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
        const MAX_BYTES = 5 * 1024 * 1024; // 5 MB hard cap
        let downloadedBytes = 0;

        const req = https.get(fileUrl, (res) => {
            if (res.statusCode && res.statusCode >= 400) {
                res.resume();
                return reject(
                    new Error(`Failed to download file: ${res.statusCode} ${res.statusMessage}`)
                );
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                if (downloadedBytes > MAX_BYTES) {
                    res.resume();
                    req.destroy(new Error('Attachment exceeds 5 MB limit'));
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => {
                if (req.destroyed) return;
                const buffer = Buffer.concat(chunks);
                let contentType =
                    (res.headers['content-type'] as string) || 'application/octet-stream';

                // If server returns generic octet-stream, try to detect from file path
                if (contentType === 'application/octet-stream' && filePath) {
                    contentType = getMimeTypeFromPath(filePath);
                }

                resolve({ base64: buffer.toString('base64'), mimeType: contentType });
            });
            res.on('error', (err) => {
                if (!req.destroyed) {
                    reject(err);
                }
            });
        });

        req.on('error', reject);

        req.setTimeout(30000, () => {
            if (!req.destroyed) {
                req.destroy(new Error('File download timed out'));
            }
        });
    });
}

// Helper to load prompts from DextoAgent
async function loadPrompts(agent: DextoAgent): Promise<void> {
    try {
        cachedPrompts = await agent.listPrompts();
        const count = Object.keys(cachedPrompts).length;
        logger.info(`📝 Loaded ${count} prompts from DextoAgent`, 'green');
    } catch (error) {
        logger.error(`Failed to load prompts: ${error instanceof Error ? error.message : error}`);
        cachedPrompts = {};
    }
}

// Insert initTelegramBot to wire up a TelegramBot given pre-initialized services
export async function startTelegramBot(agent: DextoAgent) {
    if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }

    // Load prompts from DextoAgent at startup
    await loadPrompts(agent);

    // Create and start Telegram Bot
    const bot = new Bot(token);
    logger.info('Telegram bot started', 'green');

    // Helper to get or create session for a Telegram user
    // Each Telegram user gets their own persistent session
    function getTelegramSessionId(userId: number): string {
        return `telegram-${userId}`;
    }

    // /start command with command buttons
    bot.command('start', async (ctx) => {
        const keyboard = new InlineKeyboard();

        // Get config prompts (most useful for general tasks)
        const configPrompts = Object.entries(cachedPrompts)
            .filter(([_, info]) => info.source === 'config')
            .slice(0, 6); // Limit to 6 prompts for cleaner UI

        // Add prompt buttons in rows of 2
        for (let i = 0; i < configPrompts.length; i += 2) {
            const [name1, info1] = configPrompts[i]!;
            const button1 = info1.title || name1;
            keyboard.text(button1, `prompt_${name1}`);

            if (i + 1 < configPrompts.length) {
                const [name2, info2] = configPrompts[i + 1]!;
                const button2 = info2.title || name2;
                keyboard.text(button2, `prompt_${name2}`);
            }
            keyboard.row();
        }

        // Add utility buttons
        keyboard.text('🔄 Reset', 'reset').text('❓ Help', 'help');

        const helpText =
            '*Welcome to Dexto AI Bot!* 🤖\n\n' +
            'I can help you with various tasks. Here are your options:\n\n' +
            '**Direct Chat:**\n' +
            "• Send any text, image, or audio and I'll respond\n\n" +
            '**Slash Commands:**\n' +
            '• `/ask <question>` - Ask anything\n' +
            '• Use any loaded prompt as a command (e.g., `/summarize`, `/explain`)\n\n' +
            '**Quick buttons above** - Click to activate a prompt mode!';

        await ctx.reply(helpText, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });
    });

    // Dynamic command handlers for all prompts
    for (const [promptName, promptInfo] of Object.entries(cachedPrompts)) {
        // Register each prompt as a slash command
        bot.command(promptName, async (ctx) => {
            const userContext = ctx.match?.trim() || '';

            if (!ctx.from) {
                logger.error(`Telegram /${promptName} command received without from field`);
                return;
            }

            const sessionId = getTelegramSessionId(ctx.from.id);

            try {
                await ctx.replyWithChatAction('typing');

                // Use agent.resolvePrompt to get the prompt text with context
                const result = await agent.resolvePrompt(promptName, {
                    context: userContext,
                });

                // If prompt has placeholders and no context provided, ask for it
                if (!result.text.trim() && !userContext) {
                    await ctx.reply(
                        `Please provide context for this prompt.\n\nExample: \`/${promptName} your text here\``,
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }

                // Generate response using the resolved prompt
                const response = await agent.generate(result.text, sessionId);
                await ctx.reply(response.content || '🤖 No response generated');
            } catch (err) {
                logger.error(
                    `Error handling /${promptName} command: ${err instanceof Error ? err.message : err}`
                );
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                await ctx.reply(`Error: ${errorMessage}`);
            }
        });
    }

    // Handle button callbacks (prompt buttons and actions)
    bot.on('callback_query:data', async (ctx) => {
        const action = ctx.callbackQuery.data;
        const sessionId = getTelegramSessionId(ctx.callbackQuery.from.id);

        try {
            // Handle prompt buttons (e.g., prompt_summarize, prompt_explain)
            if (action.startsWith('prompt_')) {
                const promptName = action.substring(7); // Remove 'prompt_' prefix
                const promptInfo = cachedPrompts[promptName];

                if (!promptInfo) {
                    await ctx.answerCallbackQuery({ text: 'Prompt not found' });
                    return;
                }

                await ctx.answerCallbackQuery({
                    text: `Executing ${promptInfo.title || promptName}...`,
                });

                try {
                    await ctx.replyWithChatAction('typing');

                    // Try to resolve and execute the prompt directly
                    const result = await agent.resolvePrompt(promptName, {});

                    // If prompt resolved to empty (requires context), ask for input
                    if (!result.text.trim()) {
                        const description =
                            promptInfo.description || `Use ${promptInfo.title || promptName}`;
                        await ctx.reply(
                            `Send your text, image, or audio for *${promptInfo.title || promptName}*:`,
                            {
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    force_reply: true,
                                    selective: true,
                                    input_field_placeholder: description,
                                },
                            }
                        );
                        return;
                    }

                    // Prompt is self-contained, execute it directly
                    const response = await agent.generate(result.text, sessionId);
                    await ctx.reply(response.content || '🤖 No response generated');
                } catch (error) {
                    logger.error(
                        `Error executing prompt ${promptName}: ${error instanceof Error ? error.message : error}`
                    );
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    await ctx.reply(`❌ Error: ${errorMessage}`);
                }
            } else if (action === 'reset') {
                await agent.resetConversation(sessionId);
                await ctx.answerCallbackQuery({ text: '✅ Conversation reset' });
                await ctx.reply('🔄 Conversation has been reset.');
            } else if (action === 'help') {
                // Build dynamic help text showing available prompts
                const promptNames = Object.keys(cachedPrompts).slice(0, 10);
                const promptList = promptNames.map((name) => `\`/${name}\``).join(', ');

                const helpText =
                    '**Available Features:**\n' +
                    '🎤 *Voice Messages* - Send audio for transcription\n' +
                    '🖼️ *Images* - Send photos for analysis\n' +
                    '📝 *Text* - Any question or request\n\n' +
                    '**Slash Commands** (use any prompt):\n' +
                    `${promptList}\n\n` +
                    '**Quick Tip:** Use the buttons from /start for faster interaction!';

                await ctx.answerCallbackQuery();
                await ctx.reply(helpText, { parse_mode: 'Markdown' });
            }
        } catch (error) {
            logger.error(
                `Error handling callback query: ${error instanceof Error ? error.message : error}`
            );
            await ctx.answerCallbackQuery({ text: '❌ Error occurred' });
            try {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                await ctx.reply(`Error: ${errorMessage}`);
            } catch (e) {
                logger.error(
                    `Failed to send error message for callback query: ${e instanceof Error ? e.message : e}`
                );
            }
        }
    });

    // Group chat slash command: /ask <your question>
    bot.command('ask', async (ctx) => {
        const question = ctx.match;
        if (!question) {
            await ctx.reply('Please provide a question, e.g. `/ask How do I ...?`', {
                parse_mode: 'Markdown',
            });
            return;
        }
        if (!ctx.from) {
            logger.error('Telegram /ask command received without from field');
            return;
        }
        const sessionId = getTelegramSessionId(ctx.from.id);
        try {
            await ctx.replyWithChatAction('typing');
            const response = await agent.generate(question, sessionId);
            await ctx.reply(response.content || '🤖 No response generated');
        } catch (err) {
            logger.error(
                `Error handling /ask command: ${err instanceof Error ? err.message : err}`
            );
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            await ctx.reply(`Error: ${errorMessage}`);
        }
    });

    // Inline query handler (for @botname query in any chat)
    bot.on('inline_query', async (ctx) => {
        const query = ctx.inlineQuery.query;
        if (!query) {
            return;
        }

        const userId = ctx.inlineQuery.from.id;
        const queryText = query.trim();
        const cacheKey = `${userId}:${queryText}`;
        const now = Date.now();

        // Debounce: return cached results if query repeated within interval
        const cached = inlineQueryCache[cacheKey];
        if (cached && now - cached.timestamp < INLINE_QUERY_DEBOUNCE_INTERVAL) {
            await ctx.answerInlineQuery(cached.results);
            return;
        }

        // Concurrency cap
        if (currentInlineQueries >= MAX_CONCURRENT_INLINE_QUERIES) {
            // Too many concurrent inline queries; respond with empty list
            await ctx.answerInlineQuery([]);
            return;
        }

        currentInlineQueries++;
        try {
            const sessionId = getTelegramSessionId(userId);
            const queryTimeout = 15000; // 15 seconds timeout
            const responsePromise = agent.generate(query, sessionId);

            const response = await Promise.race([
                responsePromise,
                new Promise<{ content: string }>((_, reject) =>
                    setTimeout(() => reject(new Error('Query timed out')), queryTimeout)
                ),
            ]);

            const resultText = response.content || 'No response';
            const results = [
                {
                    type: 'article' as const,
                    id: ctx.inlineQuery.id,
                    title: 'AI Answer',
                    input_message_content: { message_text: resultText },
                    description: resultText.substring(0, 100),
                },
            ];

            // Cache the results (cleanup old entries first to prevent unbounded growth)
            cleanupInlineQueryCache();
            inlineQueryCache[cacheKey] = { timestamp: now, results };
            await ctx.answerInlineQuery(results);
        } catch (error) {
            logger.error(
                `Error handling inline query: ${error instanceof Error ? error.message : error}`
            );
            // Inform user about the error through inline results
            try {
                await ctx.answerInlineQuery([
                    {
                        type: 'article' as const,
                        id: ctx.inlineQuery.id,
                        title: 'Error processing query',
                        input_message_content: {
                            message_text: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                        },
                        description: 'Error occurred while processing your request',
                    },
                ]);
            } catch (e) {
                logger.error(
                    `Failed to send inline query error: ${e instanceof Error ? e.message : e}`
                );
            }
        } finally {
            currentInlineQueries--;
        }
    });

    // Message handler with image + audio support and tool notifications
    bot.on('message', async (ctx) => {
        let userText = ctx.message.text || ctx.message.caption || '';
        let imageDataInput: { image: string; mimeType: string } | undefined;
        let fileDataInput: { data: string; mimeType: string; filename?: string } | undefined;
        let isAudioMessage = false;

        try {
            // Detect and process images
            if (ctx.message.photo && ctx.message.photo.length > 0) {
                const photo = ctx.message.photo[ctx.message.photo.length - 1]!;
                const file = await ctx.api.getFile(photo.file_id);
                const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
                const { base64, mimeType } = await downloadFileAsBase64(fileUrl, file.file_path);
                imageDataInput = { image: base64, mimeType };
                userText = ctx.message.caption || ''; // Use caption if available
            }

            // Detect and process audio/voice messages
            if (ctx.message.voice) {
                isAudioMessage = true;
                const voice = ctx.message.voice;
                const file = await ctx.api.getFile(voice.file_id);
                const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
                const { base64, mimeType } = await downloadFileAsBase64(fileUrl, file.file_path);

                // Telegram voice messages are always OGG format
                // Detect from file path, but fallback to audio/ogg
                const audioMimeType = mimeType.startsWith('audio/') ? mimeType : 'audio/ogg';

                fileDataInput = {
                    data: base64,
                    mimeType: audioMimeType,
                    filename: 'audio.ogg',
                };

                // Add context if audio-only (no caption)
                if (!userText) {
                    userText = '(User sent an audio message for transcription and analysis)';
                }
            }
        } catch (err) {
            logger.error(
                `Failed to process attached media in Telegram bot: ${err instanceof Error ? err.message : err}`
            );
            try {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                if (isAudioMessage) {
                    await ctx.reply(`🎤 Error processing audio: ${errorMessage}`);
                } else {
                    await ctx.reply(`🖼️ Error processing image: ${errorMessage}`);
                }
            } catch (sendError) {
                logger.error(
                    `Failed to send error message to user: ${sendError instanceof Error ? sendError.message : sendError}`
                );
            }
            return; // Stop processing if media handling fails
        }

        // Validate that we have something to process
        if (!userText && !imageDataInput && !fileDataInput) return;

        // Get session for this user
        // ctx.from can be undefined for channel posts or anonymous admin messages
        if (!ctx.from) {
            logger.debug(
                'Telegram message without user context (channel post or anonymous admin); skipping'
            );
            return;
        }

        const sessionId = getTelegramSessionId(ctx.from.id);

        // Subscribe for toolCall events
        const toolCallHandler = (payload: {
            toolName: string;
            args: unknown;
            callId?: string;
            sessionId: string;
        }) => {
            // Filter by sessionId to avoid cross-session leakage
            if (payload.sessionId !== sessionId) return;
            ctx.reply(`🔧 Calling *${payload.toolName}*`, { parse_mode: 'Markdown' }).catch((e) =>
                logger.warn(`Failed to notify tool call: ${e}`)
            );
        };
        agent.on('llm:tool-call', toolCallHandler);

        try {
            await ctx.replyWithChatAction('typing');

            // Build content array from message and attachments
            const content: import('@dexto/core').ContentPart[] = [];
            if (userText) {
                content.push({ type: 'text', text: userText });
            }
            if (imageDataInput) {
                content.push({
                    type: 'image',
                    image: imageDataInput.image,
                    mimeType: imageDataInput.mimeType,
                });
            }
            if (fileDataInput) {
                content.push({
                    type: 'file',
                    data: fileDataInput.data,
                    mimeType: fileDataInput.mimeType,
                    filename: fileDataInput.filename,
                });
            }

            const response = await agent.generate(content, sessionId);

            await ctx.reply(response.content || '🤖 No response generated');

            // Log token usage if available (optional analytics)
            if (response.usage) {
                logger.debug(
                    `Session ${sessionId} - Tokens: input=${response.usage.inputTokens}, output=${response.usage.outputTokens}`
                );
            }
        } catch (error) {
            logger.error(
                `Error handling Telegram message: ${error instanceof Error ? error.message : error}`
            );
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await ctx.reply(`❌ Error: ${errorMessage}`);
        } finally {
            agent.off('llm:tool-call', toolCallHandler);
        }
    });

    // Start the bot
    bot.start();
    return bot;
}
