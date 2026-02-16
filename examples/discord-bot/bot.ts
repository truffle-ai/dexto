import dotenv from 'dotenv';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import https from 'https';
import http from 'http'; // ADDED for http support
import { DextoAgent, logger } from '@dexto/core';

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
    fileName?: string
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
                let contentType =
                    (res.headers['content-type'] as string) || 'application/octet-stream';

                // If server returns generic octet-stream, try to detect from file name
                if (contentType === 'application/octet-stream' && fileName) {
                    contentType = getMimeTypeFromPath(fileName);
                }

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

    // Helper to get or create session for a Discord user
    // Each Discord user gets their own persistent session
    function getDiscordSessionId(userId: string): string {
        return `discord-${userId}`;
    }

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
        let imageDataInput: { image: string; mimeType: string } | undefined;
        let fileDataInput: { data: string; mimeType: string; filename?: string } | undefined;

        // Helper to determine if mime type is audio
        const isAudioMimeType = (mimeType: string): boolean => {
            return mimeType.startsWith('audio/');
        };

        // Handle attachments (images and audio)
        if (message.attachments.size > 0) {
            const attachment = message.attachments.first();
            if (attachment && attachment.url) {
                try {
                    const { base64, mimeType } = await downloadFileAsBase64(
                        attachment.url,
                        attachment.name || 'file'
                    );

                    if (isAudioMimeType(mimeType)) {
                        // Handle audio files
                        fileDataInput = {
                            data: base64,
                            mimeType,
                            filename: attachment.name || 'audio.wav',
                        };
                        // Add context if only audio (no text in message)
                        if (!userText) {
                            userText =
                                '(User sent an audio message for transcription and analysis)';
                        }
                    } else if (mimeType.startsWith('image/')) {
                        // Handle image files
                        imageDataInput = { image: base64, mimeType };
                        userText = message.content || '';
                    }
                } catch (downloadError) {
                    console.error('Failed to download attachment:', downloadError);
                    try {
                        await message.reply(
                            `⚠️ Failed to download attachment: ${downloadError instanceof Error ? downloadError.message : 'Unknown error'}. Please try again or send the message without the attachment.`
                        );
                    } catch (replyError) {
                        console.error('Error sending attachment failure message:', replyError);
                    }
                    // Continue without the attachment - if there's text content, process that
                    if (!userText) {
                        return; // If there's no text and attachment failed, nothing to process
                    }
                }
            }
        }

        // Only respond to !ask prefix or DMs
        if (!message.guild || (userText && userText.startsWith('!ask '))) {
            if (userText && userText.startsWith('!ask ')) {
                userText = userText.substring(5).trim();
            }
            if (!userText) return;

            // Subscribe for toolCall events
            const toolCallHandler = (payload: {
                toolName: string;
                args: unknown;
                callId?: string;
                sessionId: string;
            }) => {
                message.channel.send(`🔧 Calling tool **${payload.toolName}**`).catch((error) => {
                    console.error(
                        `Failed to send tool call notification for ${payload.toolName} to channel ${message.channel.id}:`,
                        error
                    );
                });
            };
            agent.on('llm:tool-call', toolCallHandler);

            try {
                const sessionId = getDiscordSessionId(message.author.id);
                await message.channel.sendTyping();

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

                const responseText = response.content;

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
                            // Adding a small delay helps with ordering and rate limits
                            await new Promise((resolve) => setTimeout(resolve, 250)); // 250ms delay
                            await message.channel.send(chunk);
                        }
                    }
                } else {
                    await message.reply(
                        '🤖 I received your message but could not generate a response.'
                    );
                }

                // Log token usage if available (optional analytics)
                if (response.usage) {
                    logger.debug(
                        `Session ${sessionId} - Tokens: input=${response.usage.inputTokens}, output=${response.usage.outputTokens}`
                    );
                }
            } catch (error) {
                console.error('Error handling Discord message', error);
                try {
                    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                    await message.reply(`❌ Error: ${errorMessage}`);
                } catch (replyError) {
                    console.error('Error sending error reply:', replyError);
                }
            } finally {
                agent.off('llm:tool-call', toolCallHandler);
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
