import dotenv from 'dotenv';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import https from 'https';
import http from 'http'; // ADDED for http support
import { DextoAgent } from '@core/index.js';

// Load environment variables
dotenv.config();
const token = process.env.DISCORD_BOT_TOKEN;

// User-based cooldown system for Discord interactions
const userCooldowns = new Map<string, number>();
const RATE_LIMIT_ENABLED = process.env.DISCORD_RATE_LIMIT_ENABLED?.toLowerCase() !== 'false'; // default-on
let COOLDOWN_SECONDS = Number(process.env.DISCORD_RATE_LIMIT_SECONDS ?? 5);

if (Number.isNaN(COOLDOWN_SECONDS) || COOLDOWN_SECONDS < 0) {
    console.error(
        'DISCORD_RATE_LIMIT_SECONDS must be a non-negative number. Defaulting to 5 seconds.'
    );
    COOLDOWN_SECONDS = 5; // Default to a safe value
}

// Helper to download a file URL and convert it to base64
async function downloadFileAsBase64(
    fileUrl: string
): Promise<{ base64: string; mimeType: string }> {
    return new Promise((resolve, reject) => {
        const protocol = fileUrl.startsWith('https:') ? https : http; // Determine protocol
        const MAX_BYTES = 5 * 1024 * 1024; // 5 MB hard cap
        let downloadedBytes = 0;

        const req = protocol.get(fileUrl, (res) => {
            // Store the request object
            if (res.statusCode && res.statusCode >= 400) {
                // Clean up response stream
                res.resume();
                return reject(
                    new Error(`Failed to download file: ${res.statusCode} ${res.statusMessage}`)
                );
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                if (downloadedBytes > MAX_BYTES) {
                    // Clean up response stream before destroying request
                    res.resume();
                    req.destroy(new Error('Attachment exceeds 5 MB limit')); // Destroy the request
                    // No explicit reject here, as 'error' on req should handle it or timeout will occur
                    return;
                }
                chunks.push(chunk);
            });
            res.on('end', () => {
                if (req.destroyed) return; // If request was destroyed due to size limit, do nothing
                const buffer = Buffer.concat(chunks);
                const contentType =
                    (res.headers['content-type'] as string) || 'application/octet-stream';
                resolve({ base64: buffer.toString('base64'), mimeType: contentType });
            });
            // Handle errors on the response stream itself (e.g., premature close)
            res.on('error', (err) => {
                if (!req.destroyed) {
                    // Avoid double-rejection if req.destroy() already called this
                    reject(err);
                }
            });
        });

        // Handle errors on the request object (e.g., socket hang up, DNS resolution error, or from req.destroy())
        req.on('error', (err) => {
            reject(err);
        });

        // Optional: Add a timeout for the request
        req.setTimeout(30000, () => {
            // 30 seconds timeout
            if (!req.destroyed) {
                req.destroy(new Error('File download timed out'));
            }
        });
    });
}

// Insert initDiscordBot to wire up a Discord client given pre-initialized services
export function startDiscordBot(agent: DextoAgent) {
    if (!token) {
        throw new Error('DISCORD_BOT_TOKEN is not set');
    }

    const agentEventBus = agent.agentEventBus;

    // Create Discord client
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.DirectMessages,
        ],
        partials: [Partials.Channel],
    });

    client.once('ready', () => {
        console.log(`Discord bot logged in as ${client.user?.tag || 'Unknown'}`);
    });

    client.on('messageCreate', async (message) => {
        // Ignore bots
        if (message.author.bot) return;

        if (RATE_LIMIT_ENABLED && COOLDOWN_SECONDS > 0) {
            // Only apply cooldown if enabled and seconds > 0
            const now = Date.now();
            const cooldownEnd = userCooldowns.get(message.author.id) || 0;

            if (now < cooldownEnd) {
                const timeLeft = (cooldownEnd - now) / 1000;
                try {
                    await message.reply(
                        `Please wait ${timeLeft.toFixed(1)} more seconds before using this command again.`
                    );
                } catch (replyError) {
                    console.error('Error sending cooldown message:', replyError);
                }
                return;
            }
        }

        let userText: string | undefined = message.content;
        let imageDataInput: any;

        // Handle attachments (images)
        if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            if (attachment && attachment.url) {
                const { base64, mimeType } = await downloadFileAsBase64(attachment.url);
                imageDataInput = { image: base64, mimeType };
                userText = message.content || '';
            }
        }

        // Only respond to !ask prefix or DMs
        if (!message.guild || (userText && userText.startsWith('!ask '))) {
            if (userText && userText.startsWith('!ask ')) {
                userText = userText.substring(5).trim();
            }
            if (!userText) return;

            // Subscribe for toolCall events
            const toolCallHandler = (payload: { toolName: string; args: any; callId?: string }) => {
                message.channel
                    .send(
                        `🔧 Calling tool **${payload.toolName}** with args: ${JSON.stringify(payload.args)}`
                    )
                    .catch((error) => {
                        console.error(
                            `Failed to send tool call notification for ${payload.toolName} to channel ${message.channel.id}:`,
                            error
                        );
                    });
            };
            agentEventBus.on('llmservice:toolCall', toolCallHandler);

            try {
                await message.channel.sendTyping();
                const responseText = await agent.run(userText, imageDataInput);
                // Handle Discord's 2000 character limit
                const MAX_LENGTH = 1900; // Leave some buffer
                if (responseText && responseText.length <= MAX_LENGTH) {
                    await message.reply(responseText);
                } else if (responseText) {
                    // Split into chunks and send multiple messages
                    let remaining = responseText;
                    let isFirst = true;

                    while (remaining && remaining.length > 0) {
                        const chunk = remaining.substring(0, MAX_LENGTH);
                        remaining = remaining.substring(MAX_LENGTH);

                        if (isFirst) {
                            await message.reply(chunk);
                            isFirst = false;
                        } else {
                            // For subsequent chunks, use message.channel.send to avoid a chain of replies
                            // and to ensure messages are sent in order.
                            // Adding a small delay can also help with ordering and rate limits.
                            await new Promise((resolve) => setTimeout(resolve, 250)); // 250ms delay
                            await message.channel.send(chunk);
                        }
                    }
                } else {
                    await message.reply(
                        'I received your message but could not generate a response.'
                    );
                }
            } catch (error) {
                console.error('Error handling Discord message', error);
                try {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    await message.reply(`Error: ${errorMessage}`);
                } catch (replyError) {
                    console.error('Error sending error reply:', replyError);
                }
            } finally {
                agentEventBus.off('llmservice:toolCall', toolCallHandler);
                // Set cooldown for the user after processing
                if (RATE_LIMIT_ENABLED && COOLDOWN_SECONDS > 0) {
                    userCooldowns.set(message.author.id, Date.now() + COOLDOWN_SECONDS * 1000);
                }
            }
        }
    });

    client.login(token);
    return client;
}
