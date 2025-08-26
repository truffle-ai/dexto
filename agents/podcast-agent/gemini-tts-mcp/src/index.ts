#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    CallToolResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z, ZodSchema } from 'zod';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

// --- Configuration ---
const VOICES = {
    Zephyr: 'Bright',
    Puck: 'Upbeat',
    Charon: 'Informative',
    Kore: 'Firm',
    Fenrir: 'Excitable',
    Leda: 'Youthful',
    Orus: 'Firm',
    Aoede: 'Breezy',
    Callirrhoe: 'Easy-going',
    Autonoe: 'Bright',
    Enceladus: 'Breathy',
    Iapetus: 'Clear',
    Umbriel: 'Easy-going',
    Algieba: 'Smooth',
    Despina: 'Smooth',
    Erinome: 'Clear',
    Algenib: 'Gravelly',
    Rasalgethi: 'Informative',
    Laomedeia: 'Upbeat',
    Achernar: 'Soft',
    Alnilam: 'Firm',
    Schedar: 'Even',
    Gacrux: 'Mature',
    Pulcherrima: 'Forward',
    Achird: 'Friendly',
    Zubenelgenubi: 'Casual',
    Vindemiatrix: 'Gentle',
    Sadachbia: 'Lively',
    Sadaltager: 'Knowledgeable',
    Sulafat: 'Warm',
} as const;

const LANGUAGES = {
    'ar-EG': 'Arabic (Egyptian)',
    'en-US': 'English (US)',
    'fr-FR': 'French (France)',
    'de-DE': 'German (Germany)',
    'es-US': 'Spanish (US)',
    'hi-IN': 'Hindi (India)',
    'id-ID': 'Indonesian (Indonesia)',
    'it-IT': 'Italian (Italy)',
    'ja-JP': 'Japanese (Japan)',
    'ko-KR': 'Korean (Korea)',
    'pt-BR': 'Portuguese (Brazil)',
    'ru-RU': 'Russian (Russia)',
    'nl-NL': 'Dutch (Netherlands)',
    'pl-PL': 'Polish (Poland)',
    'th-TH': 'Thai (Thailand)',
    'tr-TR': 'Turkish (Turkey)',
    'vi-VN': 'Vietnamese (Vietnam)',
    'ro-RO': 'Romanian (Romania)',
    'uk-UA': 'Ukrainian (Ukraine)',
    'bn-BD': 'Bengali (Bangladesh)',
    'en-IN': 'English (India)',
    'mr-IN': 'Marathi (India)',
    'ta-IN': 'Tamil (India)',
    'te-IN': 'Telugu (India)',
} as const;

// --- Helper Functions ---
function checkApiKey(): boolean {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    return Boolean(apiKey);
}

function makeOutputPath(outputDirectory?: string): string {
    if (outputDirectory) {
        if (!existsSync(outputDirectory)) {
            mkdirSync(outputDirectory, { recursive: true });
        }
        return outputDirectory;
    }
    return process.cwd();
}

function makeOutputFile(prefix: string, text: string, extension: string = 'wav'): string {
    const textHash = createHash('md5').update(text).digest('hex').substring(0, 8);
    const timestamp = Date.now();
    return `${prefix}_${textHash}_${timestamp}.${extension}`;
}

function saveAudioFile(filePath: string, audioData: Buffer): void {
    writeFileSync(filePath, audioData);
}

// --- Dummy Audio Generation ---
function generateDummyAudio(durationSeconds: number = 2.0): Buffer {
    const sampleRate = 24000;
    const samples = Math.floor(sampleRate * durationSeconds);

    // Create a simple sine wave tone (440 Hz)
    const frequency = 440;
    const amplitude = 0.1; // Low amplitude to avoid clipping

    const pcmData = Buffer.alloc(samples * 2); // 16-bit = 2 bytes per sample

    for (let i = 0; i < samples; i++) {
        const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude;
        const intSample = Math.floor(sample * 32767); // Convert to 16-bit integer
        pcmData.writeInt16LE(intSample, i * 2);
    }

    return convertPCMToWAV(pcmData, sampleRate);
}

// --- Tool Schemas ---
const GenerateSpeechSchema = z.object({
    text: z.string().describe('Text to convert to speech'),
    voice_name: z.enum(Object.keys(VOICES) as [string, ...string[]]).describe('Voice to use'),
    tone: z
        .string()
        .optional()
        .describe(
            "Natural language tone instruction (e.g., 'Say cheerfully:', 'Speak in a formal tone:')"
        ),
    output_directory: z.string().optional().describe('Directory to save audio file'),
});

const SpeakerConfigSchema = z.object({
    name: z.string().describe('Speaker name'),
    voice: z.enum(Object.keys(VOICES) as [string, ...string[]]).describe('Voice to use'),
    characteristics: z.string().optional().describe('Voice characteristics'),
});

const GenerateMultiSpeakerSpeechSchema = z
    .object({
        text: z
            .string()
            .describe("Text with speaker labels (e.g., 'Speaker1: Hello! Speaker2: Hi there!')"),
        speakers: z
            .array(SpeakerConfigSchema)
            .describe(
                'REQUIRED: List of speaker configurations. Must include name and voice for each speaker mentioned in the text.'
            ),
        output_directory: z.string().optional().describe('Directory to save audio file'),
    })
    .strict();

const ListVoicesSchema = z.object({});
const ListLanguagesSchema = z.object({});

// --- Audio Conversion Helper ---
function convertPCMToWAV(pcmData: Buffer, sampleRate: number = 24000): Buffer {
    const channels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * channels * bitsPerSample) / 8;
    const blockAlign = (channels * bitsPerSample) / 8;

    const header = Buffer.alloc(44);

    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcmData.length, 4);
    header.write('WAVE', 8);

    // fmt chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // PCM format size
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);

    // data chunk
    header.write('data', 36);
    header.writeUInt32LE(pcmData.length, 40);

    return Buffer.concat([header, pcmData]);
}

// --- Tool Implementations ---
async function generateSpeech(input: z.infer<typeof GenerateSpeechSchema>): Promise<any> {
    const { text, voice_name, tone, output_directory } = input;

    if (!checkApiKey()) {
        throw new Error('GEMINI_API_KEY environment variable is required for speech generation');
    }

    try {
        // Prepare text with tone instruction
        const fullText = tone ? `${tone} ${text}` : text;

        console.error(`Generating speech for: "${fullText}" with voice: ${voice_name}`);

        // Generate content with TTS configuration via direct API call
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [{ text: fullText }],
                        },
                    ],
                    generationConfig: {
                        responseModalities: ['AUDIO'],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: {
                                    voiceName: voice_name,
                                },
                            },
                        },
                    },
                }),
            }
        );

        if (!response.ok) {
            if (response.status === 429) {
                console.warn('Received 429 rate limit error, returning dummy audio.');
                const dummyWavBuffer = generateDummyAudio();

                // Save to file
                const outputPath = makeOutputPath(output_directory);
                const outputFilename = makeOutputFile('dummy_speech', text, 'wav');
                const outputFile = join(outputPath, outputFilename);

                saveAudioFile(outputFile, dummyWavBuffer);

                const voiceDescription = VOICES[voice_name as keyof typeof VOICES];

                return {
                    content: [
                        {
                            type: 'text',
                            text: `⚠️ Rate limit exceeded (429), returning dummy audio using voice ${voice_name} (${voiceDescription})\n📁 Saved as: ${outputFile}\n⏱️ Duration: 2.0s`,
                        },
                        {
                            type: 'audio',
                            data: dummyWavBuffer.toString('base64'),
                            mimeType: 'audio/wav',
                            filename: outputFilename,
                        },
                    ],
                };
            }
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Extract audio data
        const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        if (!audioData) {
            throw new Error('No audio data received from Gemini API');
        }

        // Convert base64 to buffer and then to WAV
        const pcmBuffer = Buffer.from(audioData, 'base64');
        const wavBuffer = convertPCMToWAV(pcmBuffer);

        // Save to file
        const outputPath = makeOutputPath(output_directory);
        const outputFilename = makeOutputFile('speech', text, 'wav');
        const outputFile = join(outputPath, outputFilename);

        saveAudioFile(outputFile, wavBuffer);

        // Calculate duration estimate
        const durationSeconds = (wavBuffer.length / 48000).toFixed(2);
        const voiceDescription = VOICES[voice_name as keyof typeof VOICES];

        // Return structured content with both text and audio data
        return {
            content: [
                {
                    type: 'text',
                    text: `🎵 Audio generated successfully using voice ${voice_name} (${voiceDescription})\n📁 Saved as: ${outputFile}\n⏱️ Duration: ${durationSeconds}s`,
                },
                {
                    type: 'audio',
                    data: wavBuffer.toString('base64'),
                    mimeType: 'audio/wav',
                    filename: outputFilename,
                },
            ],
        };
    } catch (error: any) {
        console.error('Error generating speech:', error);
        throw new Error(`Failed to generate speech: ${error.message}`);
    }
}

async function generateMultiSpeakerSpeech(
    input: z.infer<typeof GenerateMultiSpeakerSpeechSchema>
): Promise<any> {
    const { text, speakers, output_directory } = input;

    if (!checkApiKey()) {
        throw new Error('GEMINI_API_KEY environment variable is required for speech generation');
    }

    if (!speakers || speakers.length === 0) {
        throw new Error(
            'Speakers array is required and must contain at least one speaker configuration with name and voice'
        );
    }

    try {
        console.error(`Generating multi-speaker speech for: "${text}" with speakers:`, speakers);

        // Create multi-speaker voice configuration
        const speakerVoiceConfigs = speakers.map((speaker) => ({
            speaker: speaker.name,
            voiceConfig: {
                prebuiltVoiceConfig: {
                    voiceName: speaker.voice,
                },
            },
        }));

        // Generate content with TTS configuration for multi-speaker via direct API call
        const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [{ text }],
                        },
                    ],
                    generationConfig: {
                        responseModalities: ['AUDIO'],
                        speechConfig: {
                            multiSpeakerVoiceConfig: {
                                speakerVoiceConfigs,
                            },
                        },
                    },
                }),
            }
        );

        if (!response.ok) {
            if (response.status === 429) {
                console.warn('Received 429 rate limit error, returning dummy audio.');
                const dummyWavBuffer = generateDummyAudio();

                // Save to file
                const outputPath = makeOutputPath(output_directory);
                const outputFilename = makeOutputFile('dummy_multi_speech', text, 'wav');
                const outputFile = join(outputPath, outputFilename);

                saveAudioFile(outputFile, dummyWavBuffer);

                // Create speaker summary
                const speakerSummary = speakers
                    .map(
                        (speaker) =>
                            `- ${speaker.name}: ${speaker.voice} (${VOICES[speaker.voice as keyof typeof VOICES]})`
                    )
                    .join('\n');

                return {
                    content: [
                        {
                            type: 'text',
                            text: `⚠️ Rate limit exceeded (429), returning dummy audio\n📁 Saved as: ${outputFile}\n⏱️ Duration: 2.0s\n\n👥 Speakers:\n${speakerSummary}`,
                        },
                        {
                            type: 'audio',
                            data: dummyWavBuffer.toString('base64'),
                            mimeType: 'audio/wav',
                            filename: outputFilename,
                        },
                    ],
                };
            }
            throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Extract audio data
        const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

        if (!audioData) {
            throw new Error('No audio data received from Gemini API');
        }

        // Convert base64 to buffer and then to WAV
        const pcmBuffer = Buffer.from(audioData, 'base64');
        const wavBuffer = convertPCMToWAV(pcmBuffer);

        // Save to file
        const outputPath = makeOutputPath(output_directory);
        const outputFilename = makeOutputFile('multi_speech', text, 'wav');
        const outputFile = join(outputPath, outputFilename);

        saveAudioFile(outputFile, wavBuffer);

        // Calculate duration estimate
        const durationSeconds = (wavBuffer.length / 48000).toFixed(2);

        // Create speaker summary
        const speakerSummary = speakers
            .map(
                (speaker) =>
                    `- ${speaker.name}: ${speaker.voice} (${VOICES[speaker.voice as keyof typeof VOICES]})`
            )
            .join('\n');

        // Return structured content with both text and audio data
        return {
            content: [
                {
                    type: 'text',
                    text: `🎭 Multi-speaker audio generated successfully\n📁 Saved as: ${outputFile}\n⏱️ Duration: ${durationSeconds}s\n\n👥 Speakers:\n${speakerSummary}`,
                },
                {
                    type: 'audio',
                    data: wavBuffer.toString('base64'),
                    mimeType: 'audio/wav',
                    filename: outputFilename,
                },
            ],
        };
    } catch (error: any) {
        console.error('Error generating multi-speaker speech:', error);
        throw new Error(`Failed to generate multi-speaker speech: ${error.message}`);
    }
}

function listVoices(): string {
    let voicesText = 'Available Gemini TTS Voices:\n\n';
    for (const [voice, characteristic] of Object.entries(VOICES)) {
        voicesText += `- **${voice}**: ${characteristic}\n`;
    }
    return voicesText;
}

function listLanguages(): string {
    let languagesText = 'Supported Languages:\n\n';
    for (const [code, name] of Object.entries(LANGUAGES)) {
        languagesText += `- **${code}**: ${name}\n`;
    }
    return languagesText;
}

// --- Tool Interface ---
interface ToolDefinition<TInput = any> {
    name: string;
    description: string;
    inputSchema: ZodSchema<TInput>;
    executeLogic: (input: TInput) => Promise<any>;
}

// --- Tool Definitions ---
const generateSpeechTool: ToolDefinition<z.infer<typeof GenerateSpeechSchema>> = {
    name: 'generate_speech',
    description: 'Generate single-speaker audio from text using Gemini TTS',
    inputSchema: GenerateSpeechSchema,
    executeLogic: async (input) => {
        return await generateSpeech(input);
    },
};

const generateMultiSpeakerSpeechTool: ToolDefinition<
    z.infer<typeof GenerateMultiSpeakerSpeechSchema>
> = {
    name: 'generate_multi_speaker_speech',
    description: 'Generate multi-speaker audio from text with conversation',
    inputSchema: GenerateMultiSpeakerSpeechSchema,
    executeLogic: async (input) => {
        return await generateMultiSpeakerSpeech(input);
    },
};

const listVoicesTool: ToolDefinition<z.infer<typeof ListVoicesSchema>> = {
    name: 'list_voices',
    description: 'Get list of available voices with characteristics',
    inputSchema: ListVoicesSchema,
    executeLogic: async () => {
        return listVoices();
    },
};

const listLanguagesTool: ToolDefinition<z.infer<typeof ListLanguagesSchema>> = {
    name: 'list_languages',
    description: 'Get list of supported languages',
    inputSchema: ListLanguagesSchema,
    executeLogic: async () => {
        return listLanguages();
    },
};

// --- Available Tools Map ---
const availableTools: Record<string, ToolDefinition> = {
    [generateSpeechTool.name]: generateSpeechTool,
    [generateMultiSpeakerSpeechTool.name]: generateMultiSpeakerSpeechTool,
    [listVoicesTool.name]: listVoicesTool,
    [listLanguagesTool.name]: listLanguagesTool,
};

// --- Server Initialization ---
const server = new Server(
    { name: 'gemini-tts-server', version: '0.1.0' },
    { capabilities: { tools: {} } }
);

// --- Helper function for schema conversion ---
function getEnumType(enumSchema: any) {
    const values = enumSchema._def.values;
    return typeof values[0] === 'string'
        ? 'string'
        : typeof values[0] === 'number'
          ? 'number'
          : 'string';
}

// --- Request Handlers ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
    const toolList = Object.values(availableTools).map((tool) => {
        const zodToJsonSchema = (schema: ZodSchema<any>) => {
            const schemaDescription: Record<string, any> = {
                type: 'object',
                properties: {},
                required: [],
            };

            if (schema instanceof z.ZodObject) {
                const shape = (schema as any)._def.shape();
                for (const [key, value] of Object.entries(shape)) {
                    const zodValue = value as any;

                    schemaDescription.properties[key] = {
                        type:
                            zodValue._def.typeName === 'ZodString'
                                ? 'string'
                                : zodValue._def.typeName === 'ZodNumber'
                                  ? 'number'
                                  : zodValue._def.typeName === 'ZodBoolean'
                                    ? 'boolean'
                                    : zodValue._def.typeName === 'ZodEnum'
                                      ? getEnumType(zodValue)
                                      : 'object',
                    };

                    if (zodValue.description) {
                        schemaDescription.properties[key].description = zodValue.description;
                    }

                    if (typeof zodValue.isOptional === 'function' && !zodValue.isOptional()) {
                        schemaDescription.required.push(key);
                    }
                }
            }

            return schemaDescription;
        };

        return {
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema ? zodToJsonSchema(tool.inputSchema) : undefined,
        };
    });

    return { tools: toolList };
});

server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<z.infer<typeof CallToolResultSchema>> => {
        const toolName = request.params.name;
        const rawArgs = request.params.arguments ?? {};

        const tool = availableTools[toolName];

        if (!tool) {
            return {
                content: [{ type: 'text', text: `Error: Unknown tool '${toolName}'` }],
                isError: true,
            };
        }

        try {
            const validatedArgs = tool.inputSchema.parse(rawArgs);
            const result = await tool.executeLogic(validatedArgs);

            // Handle structured content responses (audio generation tools)
            if (
                result &&
                typeof result === 'object' &&
                result.content &&
                Array.isArray(result.content)
            ) {
                return {
                    content: result.content,
                    isError: false,
                };
            }

            // Handle simple string responses (list tools)
            return {
                content: [
                    {
                        type: 'text',
                        text: typeof result === 'string' ? result : JSON.stringify(result),
                    },
                ],
                isError: false,
            };
        } catch (error: any) {
            let errorMessage = `Error processing tool '${toolName}': `;
            if (error instanceof z.ZodError) {
                errorMessage += `Invalid input arguments: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`;
            } else {
                errorMessage += error.message || String(error);
            }

            return {
                content: [{ type: 'text', text: errorMessage }],
                isError: true,
            };
        }
    }
);

// --- Server Execution ---
async function runServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Gemini TTS MCP server started');
}

runServer().catch((error: Error | any) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Server failed to start or connect: ${errorMessage}`);
    process.exit(1);
});
