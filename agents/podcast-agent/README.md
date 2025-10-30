# Advanced Podcast Generation Agent

An AI agent for creating multi-speaker audio content using the Gemini TTS MCP server.

## Overview

This agent uses the refactored Gemini TTS MCP server to generate high-quality speech with advanced multi-speaker capabilities. It supports 30 prebuilt voices, natural language tone control, and can generate entire conversations with multiple speakers in a single request. The server now returns audio content that can be played directly in web interfaces.

## Key Features

### 🎤 **Native Multi-Speaker Support**
- Generate conversations with multiple speakers in one request
- No need for separate audio files or post-processing
- Natural conversation flow with different voices per speaker

### 🎵 **30 Prebuilt Voices**
- **Zephyr** - Bright and energetic
- **Puck** - Upbeat and cheerful
- **Charon** - Informative and clear
- **Kore** - Firm and authoritative
- **Fenrir** - Excitable and dynamic
- **Leda** - Youthful and fresh
- **Orus** - Firm and confident
- **Aoede** - Breezy and light
- **Callirrhoe** - Easy-going and relaxed
- **Autonoe** - Bright and optimistic
- **Enceladus** - Breathy and intimate
- **Iapetus** - Clear and articulate
- **Umbriel** - Easy-going and friendly
- **Algieba** - Smooth and polished
- **Despina** - Smooth and elegant
- **Erinome** - Clear and precise
- **Algenib** - Gravelly and distinctive
- **Rasalgethi** - Informative and knowledgeable
- **Laomedeia** - Upbeat and lively
- **Achernar** - Soft and gentle
- **Alnilam** - Firm and steady
- **Schedar** - Even and balanced
- **Gacrux** - Mature and experienced
- **Pulcherrima** - Forward and engaging
- **Achird** - Friendly and warm
- **Zubenelgenubi** - Casual and approachable
- **Vindemiatrix** - Gentle and soothing
- **Sadachbia** - Lively and animated
- **Sadaltager** - Knowledgeable and wise
- **Sulafat** - Warm and inviting

### 🌐 **WebUI Compatible**
- Returns audio content that can be played directly in web interfaces
- Base64-encoded WAV audio data
- Structured content with both text summaries and audio data

### 🎭 **Natural Language Tone Control**
- "Say cheerfully: Welcome to our show!"
- "Speak in a formal tone: Welcome to our meeting"
- "Use an excited voice: This is amazing news!"
- "Speak slowly and clearly: This is important information"

## Setup

1. **Get API Keys**:
   ```bash
   export GEMINI_API_KEY="your-gemini-api-key"
   export OPENAI_API_KEY="your-openai-api-key"
   ```

2. **Run the Agent**:
   ```bash
   dexto -a agents/podcast-agent/podcast-agent.yml
   ```

The agent will automatically install the Gemini TTS MCP server from npm when needed.

## Usage Examples

### Single Speaker
```
"Generate speech: 'Welcome to our podcast' with voice 'Kore'"
"Create audio: 'Say cheerfully: Have a wonderful day!' with voice 'Puck'"
"Make a formal announcement: 'Speak in a formal tone: Important news today' with voice 'Zephyr'"
```

### Multi-Speaker Conversations
```
"Generate a conversation between Dr. Anya (voice: Kore) and Liam (voice: Puck) about AI"
"Create an interview with host (voice: Zephyr) and guest (voice: Orus) discussing climate change"
"Make a story with narrator (voice: Schedar) and character (voice: Laomedeia)"
"Generate a podcast with three speakers: host (Zephyr), expert (Kore), and interviewer (Puck)"
```

### Podcast Types
```
"Create an educational podcast about AI with clear, professional voices"
"Generate a storytelling podcast with expressive character voices"
"Make a news podcast with authoritative, formal delivery"
"Create an interview with host and guest using different voices"
```

## Available Tools

### **Gemini TTS Tools**
- `generate_speech` - Single-speaker audio generation
- `generate_conversation` - Multi-speaker conversations
- `list_voices` - Browse available voices with characteristics

### **File Management**
- `list_files` - Browse audio files
- `read_file` - Access file information
- `write_file` - Save generated content
- `delete_file` - Clean up files

## Voice Selection Guide

### **Professional Voices**
- **Kore** - Firm, authoritative (great for hosts, experts)
- **Orus** - Firm, professional (business content)
- **Zephyr** - Bright, engaging (news, announcements)
- **Schedar** - Even, balanced (narrators, guides)

### **Expressive Voices**
- **Puck** - Upbeat, enthusiastic (entertainment, stories)
- **Laomedeia** - Upbeat, energetic (dynamic content)
- **Fenrir** - Excitable, passionate (exciting topics)
- **Achird** - Friendly, warm (casual conversations)

### **Character Voices**
- **Umbriel** - Easy-going, relaxed (casual hosts)
- **Erinome** - Clear, articulate (educational content)
- **Autonoe** - Bright, optimistic (positive content)
- **Leda** - Youthful, fresh (younger audiences)

## Multi-Speaker Configuration

### **Example Speaker Setup**
```json
{
  "speakers": [
    {
      "name": "Dr. Anya",
      "voice": "Kore",
      "characteristics": "Firm, professional"
    },
    {
      "name": "Liam",
      "voice": "Puck", 
      "characteristics": "Upbeat, enthusiastic"
    }
  ]
}
```

### **Conversation Format**
```
Dr. Anya: Welcome to our science podcast!
Liam: Thanks for having me, Dr. Anya!
Dr. Anya: Today we're discussing artificial intelligence.
Liam: It's such an exciting field!
```

## Advanced Features

- **Rate Limit Handling**: Graceful fallbacks with dummy audio when API limits are hit
- **Controllable Style**: Accent, pace, and tone control
- **High-Quality Audio**: Studio-grade WAV output
- **Efficient Processing**: Single request for complex conversations
- **Structured Responses**: Both text summaries and audio data in responses

Simple, powerful, and focused on creating engaging multi-speaker audio content! 