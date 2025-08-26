---
sidebar_position: 7
---

# Image Editor Agent

Learn how to build an AI agent that provides intelligent image processing and editing capabilities. This tutorial shows how to create an agent that can analyze, transform, and enhance images through natural language commands.

## 🎥 Demo Video

Watch the Image Editor Agent in action:

<iframe
  width="100%"
  height="400"
  src="https://www.youtube.com/embed/A0j61EIgWdI"
  title="Image Editor Agent Demo"
  frameborder="0"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
  allowfullscreen="true"
></iframe>

## What You'll Build

An image editor agent that can:
- Analyze image metadata and properties
- Resize and crop images with intelligent aspect ratio handling
- Convert between image formats with quality control
- Apply filters and effects (blur, sharpen, grayscale, sepia, etc.)
- Adjust brightness, contrast, and color properties
- Add text overlays and annotations
- Detect objects, faces, and visual features
- Create image collages and compositions

## Understanding the Architecture

The image editor agent follows Dexto's framework design with clear separation of responsibilities:

1. **MCP Server**: Sets up the server and exposes image processing tools to the agent
2. **Agent**: Orchestrates workflows and handles user interaction
3. **Tools**: Contain the actual image processing logic

This architecture allows the agent to focus on understanding user intent while the tools handle the technical image processing.

## MCP Server Code

The core functionality is provided by the **Image Editor MCP Server**, a Python-based server built with FastMCP. To understand the complete MCP server implementation, refer to the [mcp-servers repository](https://github.com/truffle-ai/mcp-servers/tree/main):

- **Image Editor Server**: [src/image-editor](https://github.com/truffle-ai/mcp-servers/tree/main/src/image-editor) - Image processing, filters, computer vision, and analysis tools

## Step 1: Setting Up the Project

First, let's understand the project structure:

```
agents/image-editor-agent/
├── image-editor-agent.yml  # Agent configuration
├── Lenna.webp              # Sample image for testing
└── README.md               # Documentation
```

## Step 2: Quick Setup

The image editor agent uses a published MCP server that's automatically installed:

```bash
# From the dexto project root
dexto --agent agents/image-editor-agent/image-editor-agent.yml
```

That's it! The MCP server (`truffle-ai-image-editor-mcp`) will be automatically downloaded and installed via `uvx` on first run.

### What's Happening Behind the Scenes

The published MCP server includes these key dependencies:
- **OpenCV**: Computer vision and image processing operations
- **Pillow**: Python Imaging Library for image manipulation
- **NumPy**: Numerical computing for image data
- **NumPy**: Numerical computing for image data

## Step 3: Understanding the Agent Configuration

The agent is configured in `image-editor-agent.yml`:

```yaml
systemPrompt: |
  You are an AI assistant specialized in image editing and processing. You have access to a comprehensive set of tools for manipulating images including:
  
  - **Basic Operations**: Resize, crop, convert formats
  - **Filters & Effects**: Blur, sharpen, grayscale, sepia, invert, edge detection, emboss, vintage
  - **Adjustments**: Brightness, contrast, color adjustments
  - **Text & Overlays**: Add text to images with customizable fonts and colors
  - **Computer Vision**: Face detection, edge detection, contour analysis, circle detection, line detection
  - **Analysis**: Detailed image statistics, color analysis, histogram data

mcpServers:
  image_editor:
    type: stdio
    command: uvx
    args:
      - truffle-ai-image-editor-mcp
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

The image editor agent provides 20+ powerful tools organized into categories:

### Image Analysis
- `get_image_info` - Get detailed image metadata (dimensions, format, file size)
- `preview_image` - Get a base64 preview for UI display
- `analyze_image` - Comprehensive image analysis with statistics
- `show_image_details` - Display detailed image information

### Basic Operations
- `resize_image` - Resize images with aspect ratio preservation
- `crop_image` - Crop images to specific dimensions
- `convert_format` - Convert between image formats
- `create_thumbnail` - Create small preview images

### Filters & Effects
- `apply_filter` - Apply various filters (blur, sharpen, grayscale, sepia, etc.)
- `adjust_brightness_contrast` - Adjust brightness and contrast levels

### Drawing & Annotations
- `add_text_to_image` - Add text overlays with custom fonts and colors
- `draw_rectangle` - Draw rectangles on images
- `draw_circle` - Draw circles on images
- `draw_line` - Draw lines on images
- `draw_arrow` - Draw arrows on images
- `add_annotation` - Add text annotations with backgrounds

### Computer Vision
- `detect_objects` - Detect faces, edges, contours, circles, lines

### Advanced Features
- `create_collage` - Create image collages with various layouts
- `create_collage_template` - Use predefined collage templates
- `batch_process` - Process multiple images with the same operation
- `compare_images` - Compare two images side by side

### Utility
- `list_available_filters` - List all available filter options
- `list_collage_templates` - List available collage templates

## Step 5: Running the Agent

Start the image editor agent:

```bash
# From the project root
dexto --agent agents/image-editor-agent/image-editor-agent.yml
```

## Step 6: Testing with Example Prompts

Let's test the agent with some example prompts to understand how it works:

### Basic Image Analysis
```
"Get information about the image at /path/to/image.jpg"
```
**What happens**: The agent calls `get_image_info` to retrieve dimensions, format, and file size.

### Image Transformation
```
"Resize the image to 800x600 pixels while maintaining aspect ratio"
```
**What happens**: The agent calls `resize_image` with `maintainAspectRatio: true` to preserve proportions.

### Applying Filters
```
"Apply a sepia filter to make the image look vintage"
```
**What happens**: The agent calls `apply_filter` with `filter: "sepia"` to create a vintage effect.

### Adding Text
```
"Add the text 'Hello World' at coordinates (50, 50) with white color"
```
**What happens**: The agent calls `add_text_to_image` with the specified text, position, and color.

### Computer Vision
```
"Detect faces in the image"
```
**What happens**: The agent calls `detect_objects` with `detectionType: "faces"` to find faces.

### Creating Collages
```
"Create a collage of these three images in a grid layout"
```
**What happens**: The agent calls `create_collage` with the image paths and grid layout.

## Step 7: Understanding the Workflow

Here's how the three components work together in a typical interaction:

1. **User Request**: "Make this image brighter and add a watermark"
2. **Agent**: Interprets the request and orchestrates the workflow
3. **Tools**: Agent calls the processing functions:
   - `adjust_brightness_contrast()` - increases image brightness
   - `add_text_to_image()` - adds watermark text
4. **Response**: Agent provides the result with image context

### Example Workflow
```
User: "Take this image, resize it to 500x500, apply a blur filter, and add the text 'SAMPLE' at the bottom"

Agent Response:
"I'll help you process that image. Let me break this down into steps:
1. First, I'll resize the image to 500x500 pixels
2. Then I'll apply a blur filter
3. Finally, I'll add the text 'SAMPLE' at the bottom

[Executes tools and provides results]"
```

## Supported Formats

### Input Formats
- **JPG/JPEG**: Most common compressed format
- **PNG**: Lossless format with transparency support
- **BMP**: Uncompressed bitmap format
- **TIFF**: High-quality format for professional use
- **WebP**: Modern format with excellent compression

### Output Formats
- **JPG/JPEG**: Configurable quality settings
- **PNG**: Lossless with transparency
- **WebP**: Configurable quality with small file sizes
- **BMP**: Uncompressed format
- **TIFF**: High-quality professional format

## Common Use Cases

- **Web Development**: Optimize images, create thumbnails, convert formats
- **Content Creation**: Apply filters, add text overlays, create compositions
- **Professional Work**: Batch processing, color adjustments, quality enhancement

---

**Ready to start?** Run the setup script and begin creating intelligent image processing workflows! 