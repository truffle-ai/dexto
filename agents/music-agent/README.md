# Music Creator Agent

A comprehensive AI agent for music creation, editing, and audio processing using the [Music Creator MCP Server](https://github.com/truffle-ai/mcp-servers/tree/main/src/music).

> **⚠️ Experimental Status**: This agent is currently in experimental development. The tools have not been extensively tested in production environments and may have limitations or bugs. We're actively seeking feedback and improvements from users.
## 🧪 Experimental Features

- **Limited Testing**: Tools have been tested in controlled environments but may behave differently with various audio formats, file sizes, or system configurations
- **Active Development**: Features are being refined based on user feedback and real-world usage
- **Feedback Welcome**: We encourage users to report issues, suggest improvements, and share use cases
- **Breaking Changes**: API and tool behavior may change as we improve the implementation

## Overview

This agent provides access to professional-grade music production tools through a clean conversational interface. Built with industry-standard libraries like librosa, pydub, and music21, it offers comprehensive audio processing capabilities using the published `truffle-ai-music-creator-mcp` package.

## Features

### 🎵 Audio Analysis
- **Tempo Detection**: Automatically detect BPM and beat positions
- **Key Detection**: Identify musical key and mode
- **Spectral Analysis**: Analyze frequency spectrum, MFCC features, and audio characteristics
- **Comprehensive Analysis**: Get detailed audio information including duration, sample rate, and format

### 🎼 Music Generation
- **Melody Creation**: Generate melodies in any key and scale
- **Chord Progressions**: Create chord progressions using Roman numeral notation
- **Drum Patterns**: Generate drum patterns for rock, jazz, and funk styles
- **MIDI Export**: All generated music exports to MIDI format for further editing

### 🔊 Audio Processing
- **Format Conversion**: Convert between MP3, WAV, FLAC, OGG, M4A, AIFF, WMA
- **Volume Control**: Adjust audio levels with precise dB control
- **Audio Normalization**: Normalize audio to target levels
- **Audio Trimming**: Cut audio to specific time ranges
- **Audio Effects**: Apply reverb, echo, distortion, and filters

### 🎚️ Mixing & Arrangement
- **Audio Merging**: Combine multiple audio files with crossfade support
- **Multi-track Mixing**: Mix multiple audio tracks with individual volume control
- **Batch Processing**: Process multiple files with the same operation

## Quick Start

### Prerequisites
- **Node.js 18+**: For the Dexto framework
- **Python 3.10+**: Automatically managed by the MCP server
- **FFmpeg**: For audio processing (optional, but recommended)

### Installation

1. **Install FFmpeg** (recommended):
   ```bash
   # macOS
   brew install ffmpeg
   
   # Ubuntu/Debian
   sudo apt update && sudo apt install ffmpeg
   ```

2. **Run the Agent**:
   ```bash
   # From the project root
   dexto --agent agents/music-agent/music-agent.yml
   ```

That's it! The MCP server will be automatically downloaded and installed via `uvx` on first run.

## Usage Examples

### Audio Analysis
```
"Analyze the tempo and key of my song.mp3"
"What's the BPM of this track?"
"What key is this song in?"
```

### Music Generation
```
"Create a melody in G major at 140 BPM for 15 seconds"
"Create a I-IV-V-I chord progression in D major"
"Create a basic rock drum pattern"
```

### Audio Processing
```
"Convert my song.wav to MP3 format"
"Convert my MIDI melody to WAV format"
"Increase the volume of my vocals by 3dB"
"Normalize my guitar track to -18dB"
"Trim my song from 30 seconds to 2 minutes"
```

### Audio Effects
```
"Add reverb to my guitar with 200ms reverb time"
"Add echo to my vocals with 500ms delay and 0.7 decay"
"Add some distortion to my bass track"
```

### Mixing & Playback
```
"Mix my vocals, guitar, and drums together with the vocals at +3dB"
"Mix a MIDI melody with an MP3 drum loop"
"Create a melody in G major and play it for 5 seconds"
"Play my song.mp3 starting from 30 seconds for 10 seconds"
```

## Available Tools

### Music Generation
- `create_melody` - Generate melodies in any key and scale
- `create_chord_progression` - Create chord progressions using Roman numerals
- `create_drum_pattern` - Generate drum patterns for different styles

### Audio Analysis
- `analyze_audio` - Comprehensive audio analysis
- `detect_tempo` - Detect BPM and beat positions
- `detect_key` - Identify musical key and mode
- `get_audio_info` - Get detailed audio file information
- `get_midi_info` - Get detailed MIDI file information

### Audio Processing
- `convert_audio_format` - Convert between audio formats
- `convert_midi_to_audio` - Convert MIDI files to high-quality audio format (WAV, 44.1kHz, 16-bit)
- `adjust_volume` - Adjust audio levels in dB
- `normalize_audio` - Normalize audio to target levels
- `trim_audio` - Cut audio to specific time ranges
- `apply_audio_effect` - Apply reverb, echo, distortion, filters

### Mixing & Arrangement
- `merge_audio_files` - Combine multiple audio files
- `mix_audio_files` - Mix tracks with individual volume control (supports both audio and MIDI files)

### Playback
- `play_audio` - Play audio files with optional start time and duration
- `play_midi` - Play MIDI files with optional start time and duration

### Utility
- `list_available_effects` - List all audio effects
- `list_drum_patterns` - List available drum patterns

## Supported Formats

### Audio Formats
- **MP3**: Most common compressed format
- **WAV**: Uncompressed high-quality audio
- **FLAC**: Lossless compressed audio
- **OGG**: Open-source compressed format
- **M4A**: Apple's compressed format
- **AIFF**: Apple's uncompressed format
- **WMA**: Windows Media Audio

### MIDI Formats
- **MID**: Standard MIDI files
- **MIDI**: Alternative MIDI extension

## Configuration

### Agent Configuration
The agent is configured to use the published MCP server:

```yaml
systemPrompt: |
  You are an AI assistant specialized in music creation, editing, and production...

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

### Environment Variables
Set your OpenAI API key:

```bash
export OPENAI_API_KEY="your-api-key-here"
```

Or create a `.env` file in the project root:

```bash
OPENAI_API_KEY=your-api-key-here
```

## Use Cases

### Music Production
- Create backing tracks and accompaniments
- Generate drum patterns for different genres
- Compose melodies and chord progressions
- Mix and master audio tracks

### Audio Editing
- Clean up audio recordings
- Normalize volume levels
- Apply professional effects
- Convert between formats

### Music Analysis
- Analyze existing music for tempo and key
- Extract musical features for machine learning
- Study musical patterns and structures
- Compare different audio files

### Educational
- Learn about musical theory through generation
- Study different musical styles and patterns
- Experiment with composition techniques
- Understand audio processing concepts

## MCP Server

This agent uses the **Music Creator MCP Server**, which is maintained separately at:

**🔗 [https://github.com/truffle-ai/mcp-servers/tree/main/src/music](https://github.com/truffle-ai/mcp-servers/tree/main/src/music)**

The MCP server repository provides:
- Complete technical documentation
- Development and contribution guidelines  
- Server implementation details
- Advanced configuration options

## Troubleshooting

### Common Issues

#### 1. Server Installation
The MCP server will be automatically installed via `uvx` on first run. No manual setup required.

#### 2. "FFmpeg not found" warnings
These warnings can be safely ignored. The agent includes fallback methods using librosa and soundfile for audio processing when FFmpeg is not available.

```bash
# Optional: Install FFmpeg for optimal performance
brew install ffmpeg  # macOS
sudo apt install ffmpeg  # Ubuntu/Debian
```

#### 3. Large Audio Files
Consider trimming or converting to smaller formats for faster processing.

#### 4. Memory Usage
Monitor system memory during heavy audio operations.

### Performance Tips

1. **Large Audio Files**: Consider trimming or converting to smaller formats for faster processing
2. **Memory Usage**: Monitor system memory during heavy audio operations
3. **Batch Processing**: Use batch operations for multiple files to improve efficiency
4. **FFmpeg**: Install FFmpeg for optimal audio processing performance (optional - fallback methods available)

## Technical Details

### Dependencies
The MCP server uses industry-standard libraries:
- **librosa**: Audio analysis and music information retrieval
- **pydub**: Audio file manipulation and processing
- **music21**: Music notation and analysis
- **pretty_midi**: MIDI file handling
- **numpy**: Numerical computing
- **scipy**: Scientific computing
- **matplotlib**: Plotting and visualization

### Architecture
The agent uses a Python-based MCP server that provides:
- Fast audio processing with optimized libraries
- Memory-efficient handling of large audio files
- Thread-safe operations for concurrent processing
- Comprehensive error handling and validation

### Performance
- Supports audio files up to several hours in length
- Efficient processing of multiple file formats
- Optimized algorithms for real-time analysis
- Minimal memory footprint for batch operations

## Getting Help

- **MCP Server Issues**: Report at the [mcp-servers repository](https://github.com/truffle-ai/mcp-servers/issues)
- **Agent Configuration**: Report at the main Dexto repository
- **Feature Requests**: Use the mcp-servers repository for tool-related requests

## License

This agent configuration is part of the Dexto AI Agent framework. The MCP server is distributed under the MIT license.