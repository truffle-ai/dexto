# Advanced Podcast Generation Agent

A powerful AI agent for creating multi-speaker audio content using Google Gemini TTS with native multi-speaker support.

## Overview

This agent uses Google Gemini 2.5 TTS to generate high-quality speech with advanced multi-speaker capabilities. It supports 30 prebuilt voices, natural language tone control, and can generate entire conversations with multiple speakers in a single request.

## Key Features

### 🎤 **Native Multi-Speaker Support**
- Generate conversations with multiple speakers in one request
- No need for separate audio files or post-processing
- Natural conversation flow with different voices per speaker

### 🎵 **30 Prebuilt Voices**
- **Zephyr** - Bright
- **Puck** - Upbeat
- **Kore** - Firm
- **Orus** - Firm
- **Autonoe** - Bright
- **Umbriel** - Easy-going
- **Erinome** - Clear
- **Laomedeia** - Upbeat
- **Schedar** - Even
- **Achird** - Friendly
- And 20 more voices...

### 🌍 **24 Language Support**
- Automatic language detection
- Support for English, Spanish, French, German, Italian, Portuguese
- Japanese, Korean, Chinese, Arabic, Hindi, and more

### 🎭 **Natural Language Tone Control**
- "Say cheerfully: Welcome to our show!"
- "Speak in a formal tone: Welcome to our meeting"
- "Use an excited voice: This is amazing news!"
- "Speak slowly and clearly: This is important information"

## Setup

1. **Install Dependencies**:
   ```bash
   cd agents/podcast-agent/gemini-tts-mcp
   pip install -e .
   ```

2. **Get API Keys**:
   ```bash
   export GEMINI_API_KEY="your-gemini-api-key"
   export OPENAI_API_KEY="your-openai-api-key"
   ```

3. **Run the Agent**:
   ```bash
   saiki --agent agents/podcast-agent/podcast-agent.yml
   ```

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
- `generate_multi_speaker_speech` - Multi-speaker conversations
- `list_voices` - Browse available voices
- `list_languages` - Check supported languages

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

## Benefits Over ElevenLabs

1. **Native Multi-Speaker**: No need for separate audio files
2. **Natural Language Control**: "Say cheerfully:" instead of technical tags
3. **30 Prebuilt Voices**: More variety than ElevenLabs
4. **24 Languages**: Better international support
5. **Automatic Language Detection**: No manual specification
6. **Better Integration**: Part of Google's AI ecosystem
7. **Simpler Workflow**: One request for entire conversations

## Limitations

- Requires Gemini API key
- TTS models only accept text inputs
- 32k token context window limit
- Preview models (may have usage limits)

## Advanced Features

- **Automatic Language Detection**: No need to specify language
- **Controllable Style**: Accent, pace, and tone control
- **High-Quality Audio**: Studio-grade output
- **Efficient Processing**: Single request for complex conversations

Simple, powerful, and focused on creating engaging multi-speaker audio content! 