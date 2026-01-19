---
sidebar_position: 2
title: "Agent Registry"
---

# Agent Registry

Dexto comes with a curated collection of pre-built agents ready to use for common tasks. Each agent is optimized with specific tools, system prompts, and LLM configurations for its domain.

:::tip Adding Custom Agents
Want to add your Agent to this registry? Check out our [Community Contribution Guide](https://github.com/truffle-ai/dexto/blob/main/CONTRIBUTING.md#3-adding-agents-to-the-official-registry) for step-by-step instructions.
:::

## Quick Start

```bash
# List all available agents
dexto list-agents

# Install an agent
dexto install <agent-name>

# Use an installed agent
dexto --agent <agent-name>
```

For detailed installation instructions, see the [Installing Custom Agents guide](./installing-custom-agents).

---

## Agent Catalog Overview

| Agent | Category | Best For | LLM |
|-------|----------|----------|-----|
| [Podcast Agent](#%EF%B8%8F-podcast-agent) | Content Creation | Multi-speaker audio, podcast intros | OpenAI GPT-5 Mini |
| [Music Agent](#-music-agent) | Content Creation | Music composition, audio processing | OpenAI GPT-5 Mini |
| [Nano Banana Agent](#%EF%B8%8F-nano-banana-agent) | Content Creation | Image generation & editing | Google Gemini 2.5 Flash |
| [Sora Video Agent](#-sora-video-agent) | Content Creation | AI video generation | OpenAI GPT-5 Mini |
| [Image Editor Agent](#%EF%B8%8F-image-editor-agent) | Content Creation | Image manipulation, face detection | OpenAI GPT-5 Mini |
| [Coding Agent](#-coding-agent) | Development | Software development, debugging | Anthropic Claude Haiku 4.5 |
| [Explore Agent](#-explore-agent) | Development | Codebase exploration, research | Anthropic Claude Haiku 4.5 |
| [Database Agent](#%EF%B8%8F-database-agent) | Data & Analysis | SQL queries, database operations | OpenAI GPT-5 Mini |
| [Talk2PDF Agent](#-talk2pdf-agent) | Data & Analysis | PDF analysis, document conversation | OpenAI GPT-5 Mini |
| [Product Analysis Agent](#-product-analysis-agent) | Data & Analysis | Product analytics, user behavior | Anthropic Claude Sonnet 4.5 |
| [GitHub Agent](#-github-agent) | DevOps | GitHub operations, PR analysis | OpenAI GPT-5 Mini |
| [Workflow Builder Agent](#-workflow-builder-agent) | Automation | n8n workflow automation | OpenAI GPT-5 Mini |
| [Product Researcher](#-product-researcher) | Research | Product naming, branding research | Anthropic Claude Sonnet 4.5 |
| [Triage Agent](#-triage-agent) | Multi-Agent | Customer support routing | OpenAI GPT-5 |
| [Gaming Agent](#-gaming-agent) | Entertainment | GameBoy games, Pokemon | Anthropic Claude Sonnet 4.5 |
| [Default Agent](#%EF%B8%8F-default-agent) | General Purpose | General tasks, file operations | Any |

---

## Detailed Agent Information

### Content Creation

#### 🎙️ Podcast Agent

**ID:** `podcast-agent`
**Best For:** Multi-speaker audio content, podcast intros, voice synthesis

Create professional podcast content with realistic multi-speaker audio using Google Gemini TTS.

**Key Features:**
- Multi-speaker podcast generation
- High-quality voice synthesis
- Audio editing and production
- Various podcast format support

**Example Use:**
```bash
dexto --agent podcast-agent "Generate an intro for a tech podcast about AI"
```

**Recommended LLM:** OpenAI GPT-5 Mini

**Requires:** `GOOGLE_GENERATIVE_AI_API_KEY`

---

#### 🎵 Music Agent

**ID:** `music-agent`
**Best For:** Music creation, audio processing, sound design

AI agent specialized in music composition and audio manipulation.

**Key Features:**
- Music composition and generation
- Audio processing and effects
- Sound design capabilities
- Multiple musical styles

**Example Use:**
```bash
dexto --agent music-agent "Create a lo-fi chill beat for studying"
```

**Recommended LLM:** OpenAI GPT-5 Mini

**Tutorial:** [Music Agent Tutorial](../tutorials/cli/examples/music-agent.md)

---

#### 🖼️ Nano Banana Agent

**ID:** `nano-banana-agent`
**Best For:** Image generation, editing, object removal, style transfer

Advanced image generation and editing using Google's Nano Banana (Gemini 2.5 Flash Image) with near-instantaneous processing.

**Key Features:**
- **Image Generation** – Create stunning images from text prompts with various styles
- **Image Editing** – Modify existing images using natural language
- **Object Removal** – Remove unwanted objects while preserving backgrounds
- **Background Changes** – Replace backgrounds seamlessly
- **Image Fusion** – Combine multiple images creatively
- **Style Transfer** – Apply artistic styles with character consistency
- **Figurine Effect** – Nano Banana's signature feature
- **Multi-image Processing** – Complex compositions support

**Capabilities:**
- Near-instantaneous processing with high visual coherence
- Character consistency across multiple edits
- Scene preservation with seamless blending
- SynthID watermarks for safety
- Supports JPG, PNG, WebP, GIF (max 20MB per image)

**Example Use:**
```bash
dexto --agent nano-banana-agent "Create a futuristic cityscape with flying cars"
dexto --agent nano-banana-agent "Remove the person from this photo"
```

**Recommended LLM:** Google Gemini 2.5 Flash (Required)

**Requires:** `GOOGLE_GENERATIVE_AI_API_KEY`

**Demo:** [Image Generation Example](/examples/image-generation)

---

#### 🎬 Sora Video Agent

**ID:** `sora-video-agent`
**Best For:** AI video generation, video remixing, video management

Create AI-generated videos using OpenAI's Sora technology with comprehensive video creation and management capabilities.

**Key Features:**
- **Video Generation** – Create videos from text prompts with custom duration, resolution, and style
- **Reference-Based Creation** – Use images or videos as reference for precise generation
- **Video Management** – Monitor progress, list all videos, organize creations
- **Video Remixing** – Create variations and extensions with new prompts
- **File Management** – Auto-download and organize generated videos
- **Quality Control** – Delete unwanted videos and manage storage

**Supported Specifications:**
- **Durations:** 4s, 8s, 16s, 32s
- **Resolutions:** 720x1280 (9:16), 1280x720 (16:9), 1024x1024 (1:1), 1024x1808 (9:16 HD), 1808x1024 (16:9 HD)
- **Reference Formats:** JPG, PNG, WebP, MP4, MOV, AVI, WebM

**Example Use:**
```bash
dexto --agent sora-video-agent "Create a 16s cinematic video of a sunset over mountains"
```

**Recommended LLM:** OpenAI GPT-5 Mini

**Requires:** `OPENAI_API_KEY`

---

#### 🖌️ Image Editor Agent

**ID:** `image-editor-agent`
**Best For:** Image manipulation, face detection, OpenCV operations

General-purpose image editing and manipulation with computer vision capabilities.

**Key Features:**
- Image editing and transformation
- Face detection and annotation
- OpenCV-powered operations
- Graphics manipulation

**Example Use:**
```bash
dexto --agent image-editor-agent "Detect all faces in this image and draw bounding boxes"
```

**Recommended LLM:** OpenAI GPT-5 Mini

**Demo:** [Face Detection Example](/examples/face-detection)

---

### Development & Coding

#### 👨‍💻 Coding Agent

**ID:** `coding-agent`
**Best For:** Software development, debugging, code review, refactoring

Expert software development assistant with comprehensive internal coding tools for building, debugging, and maintaining codebases.

**Key Features:**
- **Codebase Analysis** – Read and analyze code using glob and grep patterns
- **File Operations** – Write, edit, and organize code files
- **Command Execution** – Run shell commands for testing and building
- **Debugging** – Identify and fix bugs by examining errors and code structure
- **Refactoring** – Improve code following best practices
- **Testing** – Write and run unit tests

**Internal Tools:**
- `read_file`, `write_file`, `edit_file` – File operations
- `glob_files`, `grep_content` – Code search
- `bash_exec` – Shell command execution
- `ask_user` – Interactive clarification

**Starter Prompts Include:**
- 🔍 Analyze Codebase
- 🐛 Debug Error
- ♻️ Refactor Code
- 🧪 Write Tests
- ✨ Implement Feature
- ⚡ Optimize Performance
- 🚀 Setup Project
- 👀 Code Review

**Example Use:**
```bash
dexto --agent coding-agent "Analyze this codebase and suggest improvements"
dexto --agent coding-agent "Create a landing page for a coffee brand"
```

**Recommended LLM:** Anthropic Claude Haiku 4.5

**File Support:** 50+ programming languages and config formats

**Demo:** [Snake Game Development](/examples/snake-game)

---

#### 🔍 Explore Agent

**ID:** `explore-agent`
**Best For:** Codebase exploration, finding files, understanding architecture, researching code

Fast, read-only agent optimized for codebase exploration. Designed to be spawned by other agents for quick research tasks.

**Key Features:**
- **File Discovery** – Find files matching patterns using glob
- **Content Search** – Search for text/patterns within files using grep
- **Code Reading** – Read and analyze file contents
- **Architecture Understanding** – Map relationships between components
- **Fast Response** – Optimized for speed with Haiku model

**Use Cases:**
- "What's in this folder?"
- "How does X work?"
- "Find where Y is handled"
- "Understand the architecture"
- "Explore the codebase"

**Available Tools:**
- `glob_files` – Find files matching patterns (e.g., `src/**/*.ts`)
- `grep_content` – Search for text/patterns within files
- `read_file` – Read file contents

**Example Use:**
```bash
dexto --agent explore-agent "How is authentication handled in this codebase?"
dexto --agent explore-agent "Find all API endpoints"
```

**Recommended LLM:** Anthropic Claude Haiku 4.5

**Performance Notes:**
- Read-only tools only (no write operations)
- Auto-approves all tool calls for speed
- Optimized for quick research tasks
- In-memory storage for ephemeral use

---

### Data & Analysis

#### 🗄️ Database Agent

**ID:** `database-agent`
**Best For:** SQL queries, database operations, data analysis

AI agent specialized in database operations and SQL query generation.

**Key Features:**
- SQL query generation
- Database schema analysis
- Data operations and transformations
- Query optimization suggestions

**Example Use:**
```bash
dexto --agent database-agent "Show me all users who signed up last month"
```

**Recommended LLM:** OpenAI GPT-5 Mini

**Tutorial:** [Database Agent Tutorial](../tutorials/cli/examples/database-agent.md)

---

#### 📄 Talk2PDF Agent

**ID:** `talk2pdf-agent`
**Best For:** PDF analysis, document conversation, content extraction

Conversational interface for analyzing and extracting information from PDF documents.

**Key Features:**
- PDF document analysis
- Natural language queries about content
- Information extraction
- Document summarization

**Example Use:**
```bash
dexto --agent talk2pdf-agent "Summarize the key findings in this research paper"
```

**Recommended LLM:** OpenAI GPT-5 Mini

**Tutorial:** [Talk2PDF Tutorial](../tutorials/cli/examples/talk2pdf-agent.md)

---

#### 📊 Product Analysis Agent

**ID:** `product-analysis-agent`
**Best For:** Product analytics, user behavior, feature flags, error tracking

AI agent for product analytics using PostHog MCP server.

**Key Features:**
- User growth and behavior analysis
- Feature flag management
- Error tracking and debugging
- Annotations for events
- Funnel and retention analysis

**Example Use:**
```bash
dexto --agent product-analysis-agent "Show me user growth trends over the past 30 days"
```

**Recommended LLM:** Anthropic Claude Sonnet 4.5

**Requires:** `POSTHOG_API_KEY`

---

### Automation & Integration

#### 🔧 Workflow Builder Agent

**ID:** `workflow-builder-agent`
**Best For:** n8n workflow automation, integrations, scheduled tasks

AI agent for building and managing n8n automation workflows.

**Key Features:**
- Create workflows from natural language
- Execution monitoring and debugging
- Credential guidance for service integrations
- Workflow templates (social media scheduler, etc.)

**Example Use:**
```bash
dexto --agent workflow-builder-agent "Build a social media scheduler that posts from Google Sheets"
```

**Recommended LLM:** OpenAI GPT-5 Mini

**Requires:** `N8N_MCP_URL`, `N8N_MCP_TOKEN`

---

### Collaboration & DevOps

#### 🐙 GitHub Agent

**ID:** `github-agent`
**Best For:** GitHub operations, PR analysis, repository management

Specialized agent for GitHub operations including pull request analysis, issue management, and repository insights.

**Key Features:**
- Analyze pull requests and issues
- Repository insights and statistics
- Code review assistance
- GitHub workflow automation
- Collaboration features via MCP

**Example Use:**
```bash
dexto --agent github-agent "Analyze the open pull requests in this repo"
```

**Recommended LLM:** OpenAI GPT-5 Mini

**Requires:** `GITHUB_TOKEN`

---

### Research & Branding

#### 🔍 Product Researcher

**ID:** `product-researcher`
**Best For:** Product naming, branding research, market analysis

AI agent specialized in product name research, branding strategies, and market positioning.

**Key Features:**
- Product name generation and evaluation
- Brand identity research
- Competitive analysis
- Market positioning insights
- Naming conventions and trends

**Example Use:**
```bash
dexto --agent product-researcher "Suggest names for a sustainable fashion startup"
```

**Recommended LLM:** Anthropic Claude Sonnet 4.5

**Tutorial:** [Product Name Scout Tutorial](../tutorials/cli/examples/product-name-scout-agent.md)

---

### Multi-Agent Systems

#### 🎯 Triage Agent

**ID:** `triage-agent`
**Best For:** Customer support routing, multi-agent coordination

Demonstration of a multi-agent customer support triage system that routes queries to specialized agents.

**System Architecture:**
- **Triage Agent** (Main) – Routes queries to specialized agents
- **Technical Support Agent** – Handles technical issues
- **Billing Agent** – Manages billing and payment queries
- **Product Info Agent** – Answers product-related questions
- **Escalation Agent** – Handles complex cases requiring human intervention

**Key Features:**
- Intelligent query routing
- Multi-agent coordination
- Specialized domain handling
- Escalation workflows

**Example Use:**
```bash
dexto --agent triage-agent "I need help with my billing"
```

**Recommended LLM:** OpenAI GPT-5

**Tutorial:** [Building Multi-Agent Systems](../tutorials/cli/examples/building-triage-system.md)

---

### Entertainment

#### 🎮 Gaming Agent

**ID:** `gaming-agent`
**Best For:** Playing GameBoy games like Pokemon through an emulator

AI agent that plays GameBoy games through a visual emulator with button controls and screen capture.

**Key Features:**
- **Visual Gameplay** – See and analyze the game screen in real-time
- **Button Controls** – D-pad, A, B, START, SELECT with configurable hold duration
- **ROM Management** – Load .gb and .gbc ROM files
- **Frame Control** – Wait for animations and control game timing

**Available Tools:**
- `press_up`, `press_down`, `press_left`, `press_right` – D-pad controls
- `press_a`, `press_b`, `press_start`, `press_select` – Button controls
- `load_rom` – Load a GameBoy ROM file
- `get_screen` – Capture current screen state
- `wait_frames` – Wait without input
- `list_roms` – List available ROMs

**Example Use:**
```bash
dexto --agent gaming-agent "Load Pokemon Red and start a new game"
```

**Recommended LLM:** Anthropic Claude Sonnet 4.5 (vision required)

**Note:** You must provide your own ROM files (.gb or .gbc format)

---

### General Purpose

#### ⚙️ Default Agent

**ID:** `default-agent`
**Best For:** General tasks, file operations, web automation

Default Dexto agent with filesystem and Playwright tools for general-purpose tasks.

**Key Features:**
- Filesystem operations
- Web browser automation via Playwright
- General conversation and assistance
- Task execution

**Example Use:**
```bash
dexto --agent default-agent
```

**Recommended LLM:** Any supported provider
**Comes pre-installed:** No (available in registry)

---

## Installation & Usage

### Installing Agents

```bash
# Install single agent
dexto install nano-banana-agent

# Install multiple agents
dexto install podcast-agent music-agent coding-agent

# Install with default LLM (skip preference injection)
dexto install nano-banana-agent --no-inject-preferences

# Install all agents
dexto install --all
```

### Using Installed Agents

```bash
# Use specific agent
dexto --agent coding-agent

# Auto-install and use (if not installed)
dexto -a podcast-agent "Generate a podcast intro"
```

### Managing Agents

```bash
# List installed agents
dexto list-agents --installed

# Find agent location
dexto which nano-banana-agent

# Uninstall agent
dexto uninstall music-agent
```

### Setting Default Agent

Edit `~/.dexto/preferences.yml`:

```yaml
defaults:
  defaultAgent: coding-agent  # Change to your preferred agent
```

## Agent Comparison

| Agent | Category | LLM Requirement | Special Requirements |
|-------|----------|----------------|---------------------|
| podcast-agent | Content | Google Gemini | GOOGLE_GENERATIVE_AI_API_KEY |
| music-agent | Content | Any | - |
| nano-banana-agent | Content | Google Gemini (Required) | GOOGLE_GENERATIVE_AI_API_KEY |
| sora-video-agent | Content | OpenAI GPT | OPENAI_API_KEY |
| image-editor-agent | Content | Any | - |
| database-agent | Data | Claude/GPT | - |
| talk2pdf-agent | Data | Claude/Gemini | - |
| product-analysis-agent | Data | Claude | POSTHOG_API_KEY |
| github-agent | DevOps | Claude/GPT | GITHUB_TOKEN |
| workflow-builder-agent | Automation | GPT | N8N_MCP_URL, N8N_MCP_TOKEN |
| product-researcher | Research | Claude/GPT | - |
| triage-agent | Multi-Agent | Claude/GPT | - |
| gaming-agent | Entertainment | Claude (Vision) | ROM files |
| coding-agent | Development | Any | Pre-installed |
| explore-agent | Development | Claude Haiku | - |
| default-agent | General | Any | - |

## Choosing the Right Agent

### For Content Creation
- **Images:** Use `nano-banana-agent` for fast, high-quality generation and editing
- **Videos:** Use `sora-video-agent` for AI-generated video content
- **Audio/Podcasts:** Use `podcast-agent` for multi-speaker content
- **Music:** Use `music-agent` for composition and sound design

### For Development
- **Coding:** Use `coding-agent` for comprehensive development assistance
- **Exploration:** Use `explore-agent` for fast codebase research and understanding
- **GitHub:** Use `github-agent` for repository management and PR analysis
- **Databases:** Use `database-agent` for SQL and data operations

### For Analysis & Research
- **Documents:** Use `talk2pdf-agent` for PDF analysis
- **Product Analytics:** Use `product-analysis-agent` for PostHog insights and user behavior
- **Branding:** Use `product-researcher` for naming and market research

### For Automation
- **Workflows:** Use `workflow-builder-agent` for n8n automation and integrations

### For Complex Systems
- **Multi-Agent:** Use `triage-agent` as a template for building agent coordination systems

### For Entertainment
- **Gaming:** Use `gaming-agent` to play GameBoy games like Pokemon

## API Key Requirements

Most agents require API keys for their LLM providers:

```bash
# Run setup to configure keys
dexto setup

# Or add to ~/.dexto/.env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=...
GITHUB_TOKEN=ghp_...
POSTHOG_API_KEY=phx_...
N8N_MCP_URL=https://your-instance.app.n8n.cloud/api/v1
N8N_MCP_TOKEN=...
```

## Contributing Your Own Agent

Built something useful? Share it with the community!

1. Create your agent following the [agent.yml configuration guide](./configuring-dexto/agent-yml.md)
2. Add documentation and examples
3. Submit to our [GitHub repository](https://github.com/truffle-ai/dexto)
4. See [Contributing Guide](https://github.com/truffle-ai/dexto/blob/main/CONTRIBUTING.md) for details

Pre-installed status is available for high-quality, well-documented agents that serve common use cases.

## Next Steps

- **Get Started:** Follow the [Install Your First Agent tutorial](../getting-started/install-first-agent-tutorial.mdx)
- **Install Guide:** Learn more about [installing custom agents](./installing-custom-agents)
- **Create Your Own:** Build custom agents with the [Configuration Guide](./configuring-dexto/agent-yml.md)
- **Examples:** Explore [examples and demos](/examples/intro)
- **Tutorials:** Deep-dive into agent-specific tutorials in the [tutorials section](../tutorials)
