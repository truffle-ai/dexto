# Image Editor Agent

A comprehensive AI agent for image editing and processing using the [Image Editor MCP Server](https://github.com/truffle-ai/mcp-servers/tree/main/src/image-editor).

This agent provides a complete suite of image manipulation tools through a Python-based MCP server built with OpenCV and Pillow.

## Features

### 🖼️ **Viewing & Preview**
- **Image Preview**: Get base64 previews for display in chat interfaces
- **System Viewer**: Open images in the system's default image viewer
- **Image Details**: Show detailed information in a user-friendly format
- **Thumbnail Generation**: Create quick thumbnail versions
- **Image Comparison**: Compare two images and highlight differences
- **Detailed Analysis**: Comprehensive image statistics and color analysis

### ✂️ **Basic Operations**
- **Resize**: Resize images with aspect ratio preservation
- **Crop**: Crop images to specified dimensions
- **Format Conversion**: Convert between JPG, PNG, WebP, BMP, TIFF

### 🎨 **Filters & Effects**
- **Basic**: Blur, sharpen, grayscale, invert
- **Artistic**: Sepia, vintage, cartoon, sketch
- **Detection**: Edge detection, emboss

### ⚙️ **Adjustments**
- **Brightness & Contrast**: Fine-tune image appearance
- **Color Analysis**: Detailed color statistics and histograms

### 📝 **Drawing & Annotations**
- **Basic Shapes**: Draw rectangles, circles, lines, and arrows
- **Text Overlay**: Add text with customizable font, size, color, and position
- **Annotations**: Add text with background for better visibility
- **Shape Properties**: Control thickness, fill, and positioning

### 🔍 **Computer Vision**
- **Object Detection**: Detect faces, edges, contours, circles, lines
- **Image Analysis**: Detailed statistics, color analysis, histogram data

### 🎯 **Advanced Features**
- **Collage Creation**: Create collages with multiple layout types and templates
- **Batch Processing**: Process multiple images with the same operation
- **Filter Discovery**: List all available filters and effects
- **Template System**: Predefined layouts for professional collages

## Quick Start

### Prerequisites
- **Node.js 20+**: For the Dexto framework
- **Python 3.10+**: Automatically managed by the MCP server

### Installation

1. **Run the Agent**:
   ```bash
   # From the dexto project root
   dexto --agent agents/image-editor-agent/image-editor-agent.yml
   ```

That's it! The MCP server will be automatically downloaded and installed via `uvx` on first run.

## Configuration

The agent is configured to use the published MCP server:

```yaml
mcpServers:
  image_editor:
    type: stdio
    command: uvx
    args:
      - truffle-ai-image-editor-mcp
    connectionMode: strict
```

## MCP Server

This agent uses the **Image Editor MCP Server**, which is maintained separately at:

**🔗 [https://github.com/truffle-ai/mcp-servers/tree/main/src/image-editor](https://github.com/truffle-ai/mcp-servers/tree/main/src/image-editor)**

The MCP server repository provides:
- Complete technical documentation
- Development and contribution guidelines  
- Server implementation details
- Advanced configuration options

## Available Tools

### Viewing & Preview Tools

#### `preview_image`
Get a base64 preview of an image for display in chat interfaces.

**Parameters:**
- `filePath` (string): Path to the image file
- `maxSize` (integer, optional): Maximum size for preview (default: 800)

#### `open_image_viewer`
Open an image in the system's default image viewer.

**Parameters:**
- `filePath` (string): Path to the image file

#### `show_image_details`
Display detailed information about an image in a user-friendly format.

**Parameters:**
- `filePath` (string): Path to the image file

#### `create_thumbnail`
Create a thumbnail version of an image for quick preview.

**Parameters:**
- `filePath` (string): Path to the image file
- `size` (integer, optional): Thumbnail size (default: 150)
- `outputPath` (string, optional): Path for the output thumbnail

#### `compare_images`
Compare two images and show differences.

**Parameters:**
- `image1Path` (string): Path to the first image
- `image2Path` (string): Path to the second image

### Basic Image Operations

#### `get_image_info`
Get detailed information about an image file.

**Parameters:**
- `filePath` (string): Path to the image file to analyze

#### `resize_image`
Resize an image to specified dimensions.

**Parameters:**
- `inputPath` (string): Path to the input image file
- `outputPath` (string, optional): Path for the output image
- `width` (integer, optional): Target width in pixels
- `height` (integer, optional): Target height in pixels
- `maintainAspectRatio` (boolean, optional): Whether to maintain aspect ratio (default: true)
- `quality` (integer, optional): Output quality 1-100 (default: 90)

#### `crop_image`
Crop an image to specified dimensions.

**Parameters:**
- `inputPath` (string): Path to the input image file
- `outputPath` (string, optional): Path for the output image
- `x` (integer): Starting X coordinate for cropping
- `y` (integer): Starting Y coordinate for cropping
- `width` (integer): Width of the crop area
- `height` (integer): Height of the crop area

#### `convert_format`
Convert an image to a different format.

**Parameters:**
- `inputPath` (string): Path to the input image file
- `outputPath` (string, optional): Path for the output image
- `format` (string): Target format (jpg, jpeg, png, webp, bmp, tiff)
- `quality` (integer, optional): Output quality 1-100 for lossy formats (default: 90)

### Filters & Effects

#### `apply_filter`
Apply various filters and effects to an image.

**Parameters:**
- `inputPath` (string): Path to the input image file
- `outputPath` (string, optional): Path for the output image
- `filter` (string): Type of filter (blur, sharpen, grayscale, sepia, invert, edge_detection, emboss, vintage, cartoon, sketch)
- `intensity` (number, optional): Filter intensity 0.1-5.0 (default: 1.0)

#### `list_available_filters`
List all available image filters and effects.

**Parameters:** None

### Adjustments

#### `adjust_brightness_contrast`
Adjust brightness and contrast of an image.

**Parameters:**
- `inputPath` (string): Path to the input image file
- `outputPath` (string, optional): Path for the output image
- `brightness` (number, optional): Brightness adjustment -100 to 100 (default: 0)
- `contrast` (number, optional): Contrast multiplier 0.1 to 3.0 (default: 1.0)

### Drawing & Annotations

#### `draw_rectangle`
Draw a rectangle on an image.

**Parameters:**
- `inputPath` (string): Path to the input image file
- `outputPath` (string, optional): Path for the output image
- `x` (integer): X coordinate of top-left corner
- `y` (integer): Y coordinate of top-left corner
- `width` (integer): Width of the rectangle
- `height` (integer): Height of the rectangle
- `color` (string, optional): Color in hex format (default: "#FF0000")
- `thickness` (integer, optional): Line thickness (default: 3)
- `filled` (boolean, optional): Whether to fill the rectangle (default: false)

#### `draw_circle`
Draw a circle on an image.

**Parameters:**
- `inputPath` (string): Path to the input image file
- `outputPath` (string, optional): Path for the output image
- `centerX` (integer): X coordinate of circle center
- `centerY` (integer): Y coordinate of circle center
- `radius` (integer): Radius of the circle
- `color` (string, optional): Color in hex format (default: "#00FF00")
- `thickness` (integer, optional): Line thickness (default: 3)
- `filled` (boolean, optional): Whether to fill the circle (default: false)

#### `draw_line`
Draw a line on an image.

**Parameters:**
- `inputPath` (string): Path to the input image file
- `outputPath` (string, optional): Path for the output image
- `startX` (integer): X coordinate of line start
- `startY` (integer): Y coordinate of line start
- `endX` (integer): X coordinate of line end
- `endY` (integer): Y coordinate of line end
- `color` (string, optional): Color in hex format (default: "#0000FF")
- `thickness` (integer, optional): Line thickness (default: 2)

#### `draw_arrow`
Draw an arrow on an image.

**Parameters:**
- `inputPath` (string): Path to the input image file
- `outputPath` (string, optional): Path for the output image
- `startX` (integer): X coordinate of arrow start
- `startY` (integer): Y coordinate of arrow start
- `endX` (integer): X coordinate of arrow end
- `endY` (integer): Y coordinate of arrow end
- `color` (string, optional): Color in hex format (default: "#FF00FF")
- `thickness` (integer, optional): Line thickness (default: 2)
- `tipLength` (number, optional): Arrow tip length as fraction of line (default: 0.3)

#### `add_text_to_image`
Add text overlay to an image.

**Parameters:**
- `inputPath` (string): Path to the input image file
- `outputPath` (string, optional): Path for the output image
- `text` (string): Text to add to the image
- `x` (integer): X coordinate for text placement
- `y` (integer): Y coordinate for text placement
- `fontSize` (integer, optional): Font size in pixels (default: 30)
- `color` (string, optional): Text color in hex format (default: "#FFFFFF")

#### `add_annotation`
Add an annotation with background to an image.

**Parameters:**
- `inputPath` (string): Path to the input image file
- `outputPath` (string, optional): Path for the output image
- `text` (string): Text to add to the image
- `x` (integer): X coordinate for text placement
- `y` (integer): Y coordinate for text placement
- `fontSize` (integer, optional): Font size in pixels (default: 20)
- `textColor` (string, optional): Text color in hex format (default: "#FFFFFF")
- `backgroundColor` (string, optional): Background color in hex format (default: "#000000")
- `padding` (integer, optional): Padding around text (default: 5)

### Computer Vision

#### `detect_objects`
Detect objects in an image using OpenCV.

**Parameters:**
- `inputPath` (string): Path to the input image file
- `detectionType` (string): Type of detection (faces, edges, contours, circles, lines)

#### `analyze_image`
Analyze image statistics and properties.

**Parameters:**
- `inputPath` (string): Path to the input image file

### Advanced Features

#### `create_collage`
Create a collage from multiple images with various layout options.

**Parameters:**
- `imagePaths` (array): List of image file paths
- `layout` (string, optional): Layout type (grid, horizontal, vertical, mosaic, random, custom) (default: grid)
- `outputPath` (string, optional): Path for the output collage
- `maxWidth` (integer, optional): Maximum width for individual images (default: 1200)
- `spacing` (integer, optional): Spacing between images (default: 10)
- `canvasWidth` (integer, optional): Custom canvas width for mosaic/random/custom layouts
- `canvasHeight` (integer, optional): Custom canvas height for mosaic/random/custom layouts
- `backgroundColor` (string, optional): Background color in hex format (default: "#FFFFFF")
- `customPositions` (array, optional): List of {x, y} coordinates for custom layout
- `randomSeed` (integer, optional): Seed for reproducible random layouts

#### `create_collage_template`
Create a collage using predefined templates.

**Parameters:**
- `imagePaths` (array): List of image file paths
- `template` (string, optional): Template type (photo_wall, storyboard, featured, instagram_grid, polaroid) (default: photo_wall)
- `outputPath` (string, optional): Path for the output collage
- `maxWidth` (integer, optional): Maximum canvas width (default: 1200)
- `backgroundColor` (string, optional): Background color in hex format (default: "#FFFFFF")

#### `list_collage_templates`
List all available collage templates and layouts.

**Parameters:** None

#### `batch_process`
Process multiple images with the same operation.

**Parameters:**
- `inputPaths` (array): List of input image paths
- `operation` (string): Operation type (resize, filter, brightness_contrast, convert)
- `outputDirectory` (string, optional): Output directory for processed images
- Additional parameters depend on the operation type

## Supported Image Formats

- **JPEG/JPG**: Lossy compression, good for photos
- **PNG**: Lossless compression, good for graphics with transparency
- **WebP**: Modern format with good compression
- **BMP**: Uncompressed bitmap format
- **TIFF**: High-quality format for professional use

## Dependencies

- **OpenCV**: Computer vision operations and image processing
- **Pillow**: Image manipulation and text rendering
- **NumPy**: Numerical operations
- **MCP**: Model Context Protocol server implementation

## Example Usage

### Basic Image Operations
```
"Resize the image at /path/to/image.jpg to 800x600 pixels"
"Crop the image to show only the top-left quarter"
"Convert the image to PNG format"
```

### Interactive Viewing
```
"Show me a preview of the image"
"Open this image in the system viewer"
"Display detailed information about the image"
```

### Filters and Effects
```
"Apply a vintage filter to the image"
"Create a cartoon effect on the image"
"Apply edge detection to find contours"
```

### Analysis and Detection
```
"Analyze the color statistics of the image"
"Detect faces in the image"
"Compare two images and show differences"
```

### Drawing and Annotations
```
"Draw a red rectangle around the face in the image"
"Add a circle to highlight the center point"
"Draw an arrow pointing to the important feature"
"Add an annotation saying 'Face detected' with a black background"
"Draw a line connecting two points in the image"
```

### Advanced Features
```
"Create a mosaic collage from these images"
"Create a featured layout collage with one large image"
"Create an Instagram grid from 9 photos"
"Create a custom collage with specific positions"
"List all available collage templates"
"Batch process all images in the folder to apply a blur filter"
"Show me a preview of the image"
```

## Troubleshooting

### Common Issues

1. **OpenCV Installation**: If you encounter issues with OpenCV, ensure you have the required system dependencies:
   ```bash
   # macOS
   brew install opencv
   
   # Ubuntu/Debian
   sudo apt-get install libopencv-dev
   ```

2. **Font Issues**: If text rendering fails, the server will fall back to the default font.

3. **Memory Issues**: For large images, consider resizing before processing to avoid memory constraints.

4. **Path Issues**: Ensure all file paths are absolute or correctly relative to the working directory.

## Troubleshooting

### Common Issues

1. **Server Installation**: The MCP server will be automatically installed via `uvx` on first run. No manual setup required.

2. **OpenCV Installation**: The server includes OpenCV installation - this may take a moment on first run due to the large download (35MB+).

3. **Memory Issues**: For large images, consider resizing before processing to avoid memory constraints.

4. **Path Issues**: Ensure all file paths are absolute or correctly relative to the working directory.

## Getting Help

- **MCP Server Issues**: Report at the [mcp-servers repository](https://github.com/truffle-ai/mcp-servers/issues)
- **Agent Configuration**: Report at the main Dexto repository
- **Feature Requests**: Use the mcp-servers repository for tool-related requests

## License

This project is part of the Dexto AI agent framework. 