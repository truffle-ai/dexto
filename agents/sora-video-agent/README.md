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
```
Create a video of a cat playing piano in a cozy living room
```

### Custom Settings
```
Generate an 8-second video in 16:9 format showing a sunset over mountains
```

### Reference-Based Creation
```
Create a video using this image as reference, showing the character walking through a forest
```

### Video Remixing
```
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
- Node.js 18+ for the MCP server
- Sufficient storage space for video downloads

## Workflow

1. **Plan**: Define your video concept and requirements
2. **Generate**: Create the initial video with your prompt
3. **Monitor**: Check progress and wait for completion
4. **Download**: Save the completed video to your device
5. **Iterate**: Create variations or remixes as needed
6. **Organize**: Manage your video library efficiently

This agent makes AI video generation accessible and efficient, providing all the tools you need to create professional-quality videos with OpenAI's Sora technology.
