# Gemini TTS MCP Server

A Model Context Protocol (MCP) server for Google Gemini Text-to-Speech (TTS) with multi-speaker support. This server provides high-quality speech generation capabilities for AI agents and applications.

## Features

- **Single Speaker Generation**: Generate speech from text using 30+ prebuilt voices
- **Multi-Speaker Conversations**: Create conversations with different voices for each speaker
- **Natural Language Tone Control**: Apply tone instructions like "Say cheerfully:" or "Speak in a formal tone:"
- **Multiple Language Support**: Support for 24+ languages with automatic detection
- **Flexible Output**: Save audio files with descriptive names and custom directories

## Installation

```bash
npm install @truffle-ai/gemini-tts-server
```

## Setup

1. **Get a Gemini API Key**: 
   - Visit [Google AI Studio](https://aistudio.google.com/)
   - Create a new API key for Gemini

2. **Set Environment Variable**:
   ```bash
   export GEMINI_API_KEY="your-api-key-here"
   # or
   export GOOGLE_GENERATIVE_AI_API_KEY="your-api-key-here"
   ```

## Usage

### In Saiki Agent Configuration

```yaml
mcpServers:
  gemini_tts:
    type: stdio
    command: npx
    args:
      - -y
      - "@truffle-ai/gemini-tts-server"
    env:
      GEMINI_API_KEY: $GEMINI_API_KEY
    timeout: 60000
    connectionMode: strict
```

### Available Tools

#### 1. `generate_speech`
Generate single-speaker audio from text.

**Parameters:**
- `text` (required): Text to convert to speech
- `voice_name` (required): Voice to use (see available voices below)
- `tone` (optional): Natural language tone instruction
- `output_directory` (optional): Directory to save audio file

**Example:**
```json
{
  "text": "Welcome to our podcast!",
  "voice_name": "Kore",
  "tone": "Say cheerfully:",
  "output_directory": "./audio"
}
```

#### 2. `generate_multi_speaker_speech`
Generate multi-speaker audio with conversation.

**Parameters:**
- `text` (required): Text with speaker labels
- `speakers` (required): Array of speaker configurations
- `output_directory` (optional): Directory to save audio file

**Example:**
```json
{
  "text": "Host: Welcome to our show! Guest: Thank you for having me.",
  "speakers": [
    {
      "name": "Host",
      "voice": "Zephyr",
      "characteristics": "Professional and welcoming"
    },
    {
      "name": "Guest", 
      "voice": "Puck",
      "characteristics": "Friendly and enthusiastic"
    }
  ],
  "output_directory": "./audio"
}
```

#### 3. `list_voices`
Get list of available voices with characteristics.

**Parameters:** None

#### 4. `list_languages`
Get list of supported languages.

**Parameters:** None

## Available Voices

| Voice | Characteristics |
|-------|----------------|
| Zephyr | Bright |
| Puck | Upbeat |
| Charon | Informative |
| Kore | Firm |
| Fenrir | Excitable |
| Leda | Youthful |
| Orus | Firm |
| Aoede | Breezy |
| Callirrhoe | Easy-going |
| Autonoe | Bright |
| Enceladus | Breathy |
| Iapetus | Clear |
| Umbriel | Easy-going |
| Algieba | Smooth |
| Despina | Smooth |
| Erinome | Clear |
| Algenib | Gravelly |
| Rasalgethi | Informative |
| Laomedeia | Upbeat |
| Achernar | Soft |
| Alnilam | Firm |
| Schedar | Even |
| Gacrux | Mature |
| Pulcherrima | Forward |
| Achird | Friendly |
| Zubenelgenubi | Casual |
| Vindemiatrix | Gentle |
| Sadachbia | Lively |
| Sadaltager | Knowledgeable |
| Sulafat | Warm |

## Supported Languages

- Arabic (Egyptian) - `ar-EG`
- English (US) - `en-US`
- French (France) - `fr-FR`
- German (Germany) - `de-DE`
- Spanish (US) - `es-US`
- Hindi (India) - `hi-IN`
- Indonesian (Indonesia) - `id-ID`
- Italian (Italy) - `it-IT`
- Japanese (Japan) - `ja-JP`
- Korean (Korea) - `ko-KR`
- Portuguese (Brazil) - `pt-BR`
- Russian (Russia) - `ru-RU`
- Dutch (Netherlands) - `nl-NL`
- Polish (Poland) - `pl-PL`
- Thai (Thailand) - `th-TH`
- Turkish (Turkey) - `tr-TR`
- Vietnamese (Vietnam) - `vi-VN`
- Romanian (Romania) - `ro-RO`
- Ukrainian (Ukraine) - `uk-UA`
- Bengali (Bangladesh) - `bn-BD`
- English (India) - `en-IN`
- Marathi (India) - `mr-IN`
- Tamil (India) - `ta-IN`
- Telugu (India) - `te-IN`

## Tone Control Examples

You can use natural language to control the tone of speech:

- `"Say cheerfully: Welcome to our show!"`
- `"Speak in a formal tone: Welcome to our meeting"`
- `"Use an excited voice: This is amazing news!"`
- `"Speak slowly and clearly: This is important information"`

## Development

### Building from Source

```bash
git clone https://github.com/truffle-ai/mcp-servers.git
cd mcp-servers/src/gemini-tts
npm install
npm run build
```

### Testing Locally

```bash
# Set your API key
export GEMINI_API_KEY="your-api-key-here"

# Run the server
npm run build
node dist/index.js
```

## Error Handling

The server provides detailed error messages for common issues:

- **Missing API Key**: Ensure `GEMINI_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` is set
- **Invalid Voice**: Use one of the available voices from the list
- **Network Issues**: Check your internet connection and API key validity
- **File System Errors**: Ensure output directories are writable

## License

MIT License - see LICENSE file for details.

## Contributing

Contributions are welcome! Please see the main repository for contribution guidelines. 