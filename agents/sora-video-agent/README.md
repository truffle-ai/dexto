# Sora Video Agent

A Dexto agent specialized in AI video generation using OpenAI's Sora technology. This agent provides a comprehensive interface for creating, managing, and manipulating AI-generated videos.

## Features

- **🎬 Video Generation**: Create videos from text prompts with custom settings
- **📊 Progress Monitoring**: Real-time status updates during video generation
- **🎭 Video Remixing**: Create variations and extensions of existing videos
- **📁 File Management**: Automatic download and organization of generated videos
- **🖼️ Reference Support**: Use images or videos as reference for consistent style
- **🗂️ Video Library**: List and manage all your generated videos

## Capabilities

### Video Creation
- Generate videos from detailed text prompts
- Customize duration (4s, 8s, 16s, 32s)
- Choose resolution for different platforms:
  - **Vertical (9:16)**: 720x1280, 1024x1808 - Perfect for social media
  - **Horizontal (16:9)**: 1280x720, 1808x1024 - Great for YouTube
  - **Square (1:1)**: 1024x1024 - Ideal for Instagram posts

### Reference-Based Generation
- Use existing images or videos as style references
- Maintain character consistency across multiple videos
- Apply specific visual styles or aesthetics

### Video Management
- Monitor generation progress with real-time updates
- List all your videos with status information
- Download completed videos automatically
- Delete unwanted videos to manage storage

### Creative Workflows
- Create video series with consistent characters
- Generate multiple variations of the same concept
- Extend existing videos with new scenes
- Build comprehensive video libraries

## Usage Examples

### Basic Video Generation
```text
Create a video of a cat playing piano in a cozy living room
```

### Custom Settings
```text
Generate an 8-second video in 16:9 format showing a sunset over mountains
```

### Reference-Based Creation
```text
Create a video using this image as reference, showing the character walking through a forest
```

### Video Remixing
```text
Create a remix of video_123 showing the same character but in a different setting
```

## Best Practices

1. **Detailed Prompts**: Be specific about characters, settings, actions, and mood
2. **Platform Optimization**: Choose the right aspect ratio for your target platform
3. **Progressive Creation**: Start with shorter videos for testing, then create longer versions
4. **Style Consistency**: Use reference images/videos for character or style continuity
5. **Library Management**: Regularly organize and clean up your video collection

## Technical Requirements

- OpenAI API key with Sora access
- Node.js 18+ for running npx
- Sufficient storage space for video downloads

## Setup

### Default Setup (Recommended)

By default, this agent uses the published `@truffle-ai/sora-video-server` NPM package via `npx`. No additional installation is required - the package will be automatically fetched and run when the agent starts.

```yaml
mcpServers:
  sora_video:
    type: stdio
    command: npx
    args:
      - -y
      - "@truffle-ai/sora-video-server"
    connectionMode: strict
    env:
      OPENAI_API_KEY: $OPENAI_API_KEY
```

### Local Development Setup (Optional)

If you're developing or modifying the Sora agent locally, you can override the default behavior:

1. Clone and build the MCP Sora server locally
2. Set the environment variable to point to your local installation:

```bash
export MCP_SORA_VIDEO_PATH="/path/to/mcp-servers/src/sora-video/dist/index.js"
```

3. Update the agent YAML to use the local path instead of npx:



Add the environment variable to your shell profile (`.bashrc`, `.zshrc`, etc.) to persist across sessions.

## Workflow

1. **Plan**: Define your video concept and requirements
2. **Generate**: Create the initial video with your prompt
3. **Monitor**: Check progress and wait for completion
4. **Download**: Save the completed video to your device
5. **Iterate**: Create variations or remixes as needed
6. **Organize**: Manage your video library efficiently

This agent makes AI video generation accessible and efficient, providing all the tools you need to create professional-quality videos with OpenAI's Sora technology.
