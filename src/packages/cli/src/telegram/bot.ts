#!/usr/bin/env node
import dotenv from 'dotenv';
import { Bot, InlineKeyboard } from 'grammy';
import https from 'https';
import { DextoAgent } from '@core/index.js';

// Load environment variables (including TELEGRAM_BOT_TOKEN)
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

// Insert concurrency cap and debounce cache for inline queries
const MAX_CONCURRENT_INLINE_QUERIES = process.env.TELEGRAM_INLINE_QUERY_CONCURRENCY
    ? Number(process.env.TELEGRAM_INLINE_QUERY_CONCURRENCY)
    : 5;
let currentInlineQueries = 0;
const INLINE_QUERY_DEBOUNCE_INTERVAL = 2000; // ms
const inlineQueryCache: Record<string, { timestamp: number; results: any[] }> = {};

// Helper to download a file URL and convert it to base64
async function downloadFileAsBase64(
    fileUrl: string
): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
        https
            .get(fileUrl, (res) => {
                if (res.statusCode && res.statusCode >= 400) {
                    return reject(
                        new Error(`Failed to download file: ${res.statusCode} ${res.statusMessage}`)
                    );
                }
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    const contentType =
                        (res.headers['content-type'] as string) || 'application/octet-stream';
                    resolve({ base64: buffer.toString('base64'), mimeType: contentType });
                });
            })
            .on('error', reject);
    });
}

// Insert initTelegramBot to wire up a TelegramBot given pre-initialized services
export function startTelegramBot(agent: DextoAgent) {
    if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }

    const agentEventBus = agent.agentEventBus;

    // Create and start Telegram Bot
    const bot = new Bot(token);
    console.log('Telegram bot started');

    // /start command with sample buttons
    bot.command('start', async (ctx) => {
        const keyboard = new InlineKeyboard()
            .text('🔄 Reset Conversation', 'reset')
            .row()
            .text('❓ Help', 'help');

        await ctx.reply('Welcome to Dexto AI Bot! Choose an option below:', {
            reply_markup: keyboard,
        });
    });

    // Handle button callbacks
    bot.on('callback_query:data', async (ctx) => {
        const action = ctx.callbackQuery.data;
        try {
            if (action === 'reset') {
                await agent.resetConversation();
                await ctx.reply('🔄 Conversation has been reset.');
            } else if (action === 'help') {
                await ctx.reply('Send me text or images and I will respond.');
            }
            await ctx.answerCallbackQuery();
        } catch (error) {
            console.error('Error handling callback query', error);
            // Attempt to notify user of the error
            try {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                await ctx.reply(`Error processing request: ${errorMessage}`);
            } catch (e) {
                console.error('Failed to send error message for callback query', e);
            }
        }
    });

    // Group chat slash command: /ask <your question>
    bot.command('ask', async (ctx) => {
        const question = ctx.match;
        if (!question) {
            ctx.reply('Please provide a question, e.g. `/ask How do I ...?`', {
                parse_mode: 'Markdown',
            });
            return;
        }
        try {
            await ctx.replyWithChatAction('typing');
            const answer = await agent.run(question);
            if (answer) {
                await ctx.reply(answer);
            } else {
                await ctx.reply('🤖 …agent failed to respond');
            }
        } catch (err) {
            console.error('Error handling /ask command', err);
            const errorMessage = err instanceof Error ? err.message : 'Unknown error';
            await ctx.reply(`Error: ${errorMessage}`);
        }
    });

    // Inline query handler
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
            ctx.answerInlineQuery(cached.results);
            return;
        }

        // Concurrency cap
        if (currentInlineQueries >= MAX_CONCURRENT_INLINE_QUERIES) {
            // Too many concurrent inline queries; respond with empty list
            ctx.answerInlineQuery([]);
            return;
        }

        currentInlineQueries++;
        try {
            const queryTimeout = 15000; // 15 seconds timeout
            const resultText = await Promise.race([
                agent.run(query),
                new Promise<string>((_, reject) =>
                    setTimeout(() => reject(new Error('Query timed out')), queryTimeout)
                ),
            ]);
            const results = [
                {
                    type: 'article' as const,
                    id: ctx.inlineQuery.id,
                    title: 'AI Answer',
                    input_message_content: { message_text: resultText || 'No response' },
                    description: (resultText || 'No response').substring(0, 100),
                },
            ];
            // Cache the results
            inlineQueryCache[cacheKey] = { timestamp: now, results };
            await ctx.answerInlineQuery(results);
        } catch (error) {
            console.error('Error handling inline query', error);
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
                console.error('Failed to send inline query error', e);
            }
        } finally {
            currentInlineQueries--;
        }
    });

    // Message handler with image support and toolCall notifications
    bot.on('message', async (ctx) => {
        let userText = ctx.message.text;
        let imageDataInput;

        try {
            // Detect image messages
            if (ctx.message.photo && ctx.message.photo.length > 0) {
                const photo = ctx.message.photo[ctx.message.photo.length - 1]!;
                const file = await ctx.api.getFile(photo.file_id);
                const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
                const { base64, mimeType } = await downloadFileAsBase64(fileUrl);
                imageDataInput = { image: base64, mimeType };
                userText = ctx.message.caption || ''; // Use caption if available
            }
        } catch (err) {
            console.error('Failed to process attached image in Telegram bot', err);
            try {
                const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                await ctx.reply(`🖼️ Error downloading or processing image: ${errorMessage}`);
            } catch (sendError) {
                console.error('Failed to send image error message to user', sendError);
            }
            return; // Stop processing if image handling fails
        }

        // If there's no text (even after checking caption for photos) AND no image data, then nothing to process.
        if (!userText && !imageDataInput) return;
        // If userText is undefined (e.g. only an image was sent with no caption) and no image was processed (e.g. due to an error caught above, though `return` should prevent this)
        // or simply no text was ever present and no image.
        if (userText === undefined && !imageDataInput) return;

        // Subscribe for toolCall events
        const toolCallHandler = (payload: { toolName: string; args: any; callId?: string }) => {
            ctx.reply(`Calling *${payload.toolName}* with args: ${JSON.stringify(payload.args)}`, {
                parse_mode: 'Markdown',
            });
        };
        agentEventBus.on('llmservice:toolCall', toolCallHandler);

        try {
            await ctx.replyWithChatAction('typing');
            const responseText = await agent.run(userText || '', imageDataInput);
            await ctx.reply(responseText || 'No response generated');
        } catch (error) {
            console.error('Error handling Telegram message', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await ctx.reply(`Error: ${errorMessage}`);
        } finally {
            agentEventBus.off('llmservice:toolCall', toolCallHandler);
        }
    });

    // Start the bot
    bot.start();
    return bot;
}
