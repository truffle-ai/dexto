# Nano Banana Agent

A Dexto agent that provides access to Google's **Gemini 2.5 Flash Image** model for image generation and editing through a lean, powerful MCP server.

## 🎯 Design Philosophy

This agent follows a **lean design principle**:
- **3 Essential Tools**: Only the most fundamental capabilities
- **Raw AI Power**: Exposes the full capabilities of Gemini 2.5 Flash Image
- **Natural Language**: All operations driven by detailed prompts
- **No Thin Wrappers**: Avoids redundant functions that just repackage the same capability
- **LLM-Friendly**: Designed for LLMs to leverage the underlying AI model directly

## 🎯 What is Gemini 2.5 Flash Image?

Gemini 2.5 Flash Image is Google's cutting-edge AI model that enables:
- **Near-instantaneous** image generation and editing
- **Object removal** with perfect background preservation
- **Background alteration** while maintaining subject integrity
- **Image fusion** for creative compositions
- **Style modification** with character consistency
- **Visible and invisible watermarks** (SynthID) for digital safety

## 🚀 Key Features

### Core Capabilities
- **Image Generation**: Create images from text prompts with various styles and aspect ratios
- **Image Editing**: Modify existing images based on natural language descriptions
- **Object Removal**: Remove unwanted objects while preserving the background
- **Background Changes**: Replace backgrounds while keeping subjects intact
- **Image Fusion**: Combine multiple images into creative compositions
- **Style Transfer**: Apply artistic styles to images

### Advanced Features
- **Character Consistency**: Maintain facial features and identities across edits
- **Scene Preservation**: Seamless blending with original lighting and composition
- **Multi-Image Processing**: Handle batch operations and complex compositions
- **Safety Features**: Built-in safety filters and provenance signals

## 🛠️ Setup

### Prerequisites
- Dexto framework installed
- Google AI API key (Gemini API access)
- Node.js 18.0.0 or higher

### Installation
1. **Set up environment variables**:
   ```bash
   export GOOGLE_GENERATIVE_AI_API_KEY="your-google-ai-api-key"
   # or
   export GEMINI_API_KEY="your-google-ai-api-key"
   ```

2. **Run the agent** (the MCP server will be automatically downloaded via npx):
   ```bash
   # From the dexto repository root
   npx dexto -a agents/nano-banana-agent/nano-banana-agent.yml
   ```

The agent configuration uses `npx @truffle-ai/nano-banana-server` to automatically download and run the latest version of the MCP server.

## 📋 Available Tools

The agent provides access to 3 essential tools:

### 1. `generate_image`
Generate new images from text prompts.

**Example:**
```
Generate a majestic mountain landscape at sunset in realistic style with 16:9 aspect ratio
```

### 2. `process_image`
Process existing images based on detailed instructions. This tool can handle any image editing task including object removal, background changes, style transfer, adding elements, and more.

**Example:**
```
Remove the red car in the background from /path/to/photo.jpg
```

**Example:**
```
Change the background of /path/to/portrait.jpg to a beach sunset with palm trees
```

**Example:**
```
Apply Van Gogh painting style with thick brushstrokes to /path/to/photo.jpg
```

### 3. `process_multiple_images`
Process multiple images together based on detailed instructions. This tool can combine images, create collages, blend compositions, or perform any multi-image operation.

**Example:**
```
Place the person from /path/to/person.jpg into the landscape from /path/to/landscape.jpg as if they were standing there
```

## 📤 Response Format

Successful operations return both image data and metadata:
```json
{
  "content": [
    {
      "type": "image",
      "data": "base64-encoded-image-data",
      "mimeType": "image/png"
    },
    {
      "type": "text",
      "text": "{\n  \"output_path\": \"/absolute/path/to/saved/image.png\",\n  \"size_bytes\": 12345,\n  \"format\": \"image/png\"\n}"
    }
  ]
}
```

## 🎨 Popular Use Cases

### 1. **Selfie Enhancement**
- Remove blemishes and unwanted objects
- Change backgrounds for professional photos
- Apply artistic filters and styles
- Create figurine effects (Nano Banana's signature feature)

### 2. **Product Photography**
- Remove backgrounds for clean product shots
- Add or remove objects from scenes
- Apply consistent styling across product images

### 3. **Creative Compositions**
- Fuse multiple images into unique scenes
- Apply artistic styles to photos
- Create imaginative scenarios from real photos

### 4. **Content Creation**
- Generate images for social media
- Create variations of existing content
- Apply brand-consistent styling

## 🔧 Configuration

### Environment Variables
- `GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY`: Your Google AI API key (required)

### Agent Settings
- **LLM Provider**: Google Gemini 2.5 Flash
- **Storage**: In-memory cache with SQLite database
- **Tool Confirmation**: Auto-approve mode for better development experience

## 📁 Supported Formats

**Input/Output Formats:**
- JPEG (.jpg, .jpeg)
- PNG (.png)
- WebP (.webp)
- GIF (.gif)

**File Size Limits:**
- Maximum: 20MB per image
- Recommended: Under 10MB for optimal performance

## 🎯 Example Interactions

### Generate a Creative Image
```
User: "Generate a futuristic cityscape at night with flying cars and neon lights"
Agent: I'll create a futuristic cityscape image for you using Nano Banana's image generation capabilities.
```

### Remove Unwanted Objects
```
User: "Remove the power lines from this photo: /path/to/landscape.jpg"
Agent: I'll remove the power lines from your landscape photo while preserving the natural background.
```

### Create Figurine Effect
```
User: "Transform this selfie into a mini figurine on a desk: /path/to/selfie.jpg"
Agent: I'll create Nano Banana's signature figurine effect, transforming your selfie into a mini figurine displayed on a desk.
```

### Change Background
```
User: "Change the background of this portrait to a professional office setting: /path/to/portrait.jpg"
Agent: I'll replace the background with a professional office setting while keeping you as the main subject.
```

## 🔒 Safety & Ethics

Nano Banana includes built-in safety features:
- **SynthID Watermarks**: Invisible provenance signals
- **Safety Filters**: Content moderation and filtering
- **Character Consistency**: Maintains identity integrity
- **Responsible AI**: Designed to prevent misuse

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](../../CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../../LICENSE) file for details.

---

**Note**: This agent provides access to Google's Gemini 2.5 Flash Image model through the MCP protocol. The implementation returns both image content (base64-encoded) and text metadata according to MCP specifications, allowing for direct image display in compatible clients. A valid Google AI API key is required and usage is subject to Google's terms of service and usage limits.
