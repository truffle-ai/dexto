---
sidebar_position: 8
---

# Music Creator Agent

Learn how to build an AI agent that provides comprehensive music creation and audio processing capabilities. This tutorial shows how to create an agent that can generate music, analyze audio, and process sound files through natural language commands.

## 🎥 Demo Video

Watch the Music Creator Agent in action:

<iframe
  width="100%"
  height="400"
  src="https://www.youtube.com/embed/wEnQy1zEVZw"
  title="Music Creator Agent Demo"
  frameborder="0"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
  allowfullscreen="true"
></iframe>

> **⚠️ Experimental Status**: This agent is currently in experimental development. The tools have not been extensively tested in production environments and may have limitations or bugs. We're actively seeking feedback and improvements from users.

## What You'll Build

A music creator agent that can:
- Generate melodies, chord progressions, and drum patterns
- Analyze audio for tempo, key, and musical features
- Convert between audio formats with quality control
- Apply audio effects and processing
- Mix multiple audio tracks with volume control
- Play audio and MIDI files with precise control
- Process both audio and MIDI files seamlessly

## Understanding the Architecture

The music creator agent follows Dexto's framework design with clear separation of responsibilities:

1. **MCP Server**: Sets up the server and exposes audio processing tools to the agent
2. **Agent**: Orchestrates workflows and handles user interaction
3. **Tools**: Contain the actual audio processing logic

This architecture allows the agent to focus on understanding musical intent while the tools handle the technical audio processing.

## MCP Server Code

The core functionality is provided by the **Music Agent MCP Server**, a Python-based server built with FastMCP. To understand the complete MCP server implementation, refer to the [mcp-servers repository](https://github.com/truffle-ai/mcp-servers/tree/main):

- **Music Server**: [src/music](https://github.com/truffle-ai/mcp-servers/tree/main/src/music) - Audio generation, processing, effects, and MIDI handling

## Step 1: Setting Up the Project

First, let's understand the project structure:

```
agents/music-agent/
├── music-agent.yml         # Agent configuration
└── README.md               # Documentation
```

## Step 2: Quick Setup

The music creator agent uses a published MCP server that's automatically installed:

```bash
# From the dexto project root
dexto --agent agents/music-agent/music-agent.yml
```

That's it! The MCP server (`truffle-ai-music-creator-mcp`) will be automatically downloaded and installed via `uvx` on first run.

### What's Happening Behind the Scenes

The published MCP server includes these key dependencies:
- **librosa**: Audio analysis and music information retrieval
- **pydub**: Audio file manipulation and processing
- **music21**: Music notation and analysis
- **pretty_midi**: MIDI file handling
- **FastMCP**: Model Context Protocol server framework
- **NumPy & SciPy**: Numerical computing for audio processing

## Step 3: Understanding the Agent Configuration

The agent is configured in `music-agent.yml`:

```yaml
systemPrompt: |
  You are an AI assistant specialized in music creation, editing, and production. You have access to a comprehensive set of tools for working with audio and music including:
  
  - **Audio Analysis**: Analyze audio files for tempo, key, BPM, frequency spectrum, and audio characteristics
  - **Audio Processing**: Convert formats, adjust volume, normalize, apply effects (reverb, echo, distortion, etc.)
  - **Music Generation**: Create melodies, chord progressions, drum patterns, and complete compositions
  - **Audio Manipulation**: Trim, cut, splice, loop, and arrange audio segments
  - **Effects & Filters**: Apply various audio effects and filters for creative sound design
  - **Mixing & Mastering**: Balance levels, apply compression, EQ, and mastering effects
  - **File Management**: Organize, convert, and manage audio files in various formats

mcpServers:
  music_creator:
    type: stdio
    command: uvx
    args:
      - truffle-ai-music-creator-mcp
    connectionMode: strict

llm:
  provider: openai
  model: gpt-4o-mini
  apiKey: $OPENAI_API_KEY
```

### Key Components Explained

1. **systemPrompt**: Defines the agent's capabilities and behavior
2. **mcpServers**: Connects to the Python MCP server
3. **llm**: Configures the language model for intelligent interaction

## Step 4: Available Tools

The music creator agent provides 20+ powerful tools organized into categories:

### Music Generation
- `create_melody` - Generate melodies in any key and scale
- `create_chord_progression` - Create chord progressions using Roman numerals
- `create_drum_pattern` - Generate drum patterns for different styles

### Audio Analysis
- `analyze_audio` - Comprehensive audio analysis with spectral features
- `detect_tempo` - Detect BPM and beat positions
- `detect_key` - Identify musical key and mode
- `get_audio_info` - Get detailed audio file information
- `get_midi_info` - Get detailed MIDI file information

### Audio Processing
- `convert_audio_format` - Convert between audio formats
- `convert_midi_to_audio` - Convert MIDI files to high-quality audio (WAV, 44.1kHz, 16-bit)
- `adjust_volume` - Adjust audio levels in dB
- `normalize_audio` - Normalize audio to target levels
- `trim_audio` - Cut audio to specific time ranges
- `apply_audio_effect` - Apply reverb, echo, distortion, filters

### Mixing & Arrangement
- `merge_audio_files` - Combine multiple audio files
- `mix_audio_files` - Mix tracks with individual volume control (supports both audio and MIDI)

### Playback
- `play_audio` - Play audio files with optional start time and duration
- `play_midi` - Play MIDI files with optional start time and duration

### Utility
- `list_available_effects` - List all audio effects
- `list_drum_patterns` - List available drum patterns

## Step 5: Running the Agent

Start the music creator agent:

```bash
# From the project root
dexto --agent agents/music-agent/music-agent.yml
```

## Step 6: Testing with Example Prompts

Let's test the agent with some example prompts to understand how it works:

### Music Generation
```
"Create a melody in G major at 140 BPM for 15 seconds"
```
**What happens**: The agent calls `create_melody` with the specified key, tempo, and duration.

```
"Create a I-IV-V-I chord progression in D major"
```
**What happens**: The agent calls `create_chord_progression` with the Roman numeral progression and key.

### Audio Analysis
```
"Analyze the tempo and key of my song.mp3"
```
**What happens**: The agent calls `analyze_audio` to get comprehensive audio information.

```
"What's the BPM of this track?"
```
**What happens**: The agent calls `detect_tempo` to find the beat per minute.

### Audio Processing
```
"Convert my song.wav to MP3 format"
```
**What happens**: The agent calls `convert_audio_format` to change the file format.

```
"Convert my MIDI melody to WAV format"
```
**What happens**: The agent calls `convert_midi_to_audio` to synthesize the MIDI file.

### Audio Effects
```
"Add reverb to my guitar with 200ms reverb time"
```
**What happens**: The agent calls `apply_audio_effect` with reverb parameters.

### Mixing & Playback
```
"Mix my vocals, guitar, and drums together with the vocals at +3dB"
```
**What happens**: The agent calls `mix_audio_files` with volume levels for each track.

```
"Create a melody in G major and play it for 5 seconds"
```
**What happens**: The agent calls `create_melody` followed by `play_midi` to generate and preview.

## Step 7: Understanding the Workflow

Here's how the three components work together in a typical interaction:

1. **User Request**: "Create a rock song with drums and a melody in C major"
2. **Agent**: Interprets the request and orchestrates the workflow
3. **Tools**: Agent calls the processing functions:
   - `create_drum_pattern()` - generates rock drum pattern
   - `create_melody()` - creates C major melody
   - `mix_audio_files()` - combines the tracks
4. **Response**: Agent provides the result with musical context

### Example Workflow
```
User: "Create a jazz melody in B minor, add some reverb, and play it for 10 seconds"

Agent Response:
"I'll help you create a jazz melody with reverb. Let me break this down:
1. First, I'll create a jazz melody in B minor
2. Then I'll add reverb to give it some space
3. Finally, I'll play it for you to hear

[Executes tools and provides results]"
```

## Supported Formats

- **Audio**: MP3, WAV, FLAC, OGG, M4A, AIFF, WMA
- **MIDI**: MID, MIDI

## Experimental Features

This agent is in active development. We encourage feedback on real-world usage, different genres, and various file sizes.

## Common Use Cases

- **Music Production**: Create backing tracks, generate drum patterns, compose melodies
- **Audio Editing**: Clean up recordings, normalize levels, apply effects
- **Music Analysis**: Analyze tempo, key, and musical features
- **Educational**: Learn music theory through generation and experimentation

---

**Ready to start?** Run the setup script and begin creating intelligent music workflows!

> **💡 Tip**: This is an experimental agent, so we encourage you to try different use cases and provide feedback to help improve the tools! 