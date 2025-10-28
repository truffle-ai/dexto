---
sidebar_position: 2
title: MCP Server Registry
description: Browse and discover MCP servers available in Dexto's WebUI registry
---

# MCP Server Registry

Discover MCP servers available in Dexto's WebUI. These servers can be easily installed through the Web interface or manually configured in your `agent.yml`.

:::tip Adding Custom Servers
Want to add your MCP server to this registry? Check out our [Community Contribution Guide](https://github.com/truffle-ai/dexto/blob/main/CONTRIBUTING.md#1-adding-new-mcps-to-the-webui-registry) for step-by-step instructions.
:::

## Productivity

### Filesystem
**Official MCP Server** by Anthropic

Secure file operations with configurable access controls for reading and writing files.

```yaml
mcpServers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."]
    timeout: 30000
```

**Tags:** file, directory, filesystem, io

**Homepage:** [GitHub - MCP Servers](https://github.com/modelcontextprotocol/servers)

---

### Linear
**Official MCP Server** by Linear

Manage Linear issues, projects, and workflows.

```yaml
mcpServers:
  linear:
    type: stdio
    command: npx
    args: ["-y", "mcp-remote", "https://mcp.linear.app/sse"]
    timeout: 30000
```

**Tags:** linear, tasks, projects

**Homepage:** [Linear MCP](https://mcp.linear.app)

---

### Puppeteer
**Official MCP Server** by Truffle AI

Browser automation and web interaction tools.

```yaml
mcpServers:
  puppeteer:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/puppeteer-server"]
    timeout: 30000
```

**Tags:** browser, automation, web, puppeteer

**Homepage:** [GitHub - Truffle AI MCP Servers](https://github.com/truffle-ai/mcp-servers)

---

## Creative

### Meme Generator
**Community MCP Server**

Create memes using Imgflip templates.

```yaml
mcpServers:
  meme-mcp:
    type: stdio
    command: npx
    args: ["-y", "meme-mcp"]
    env:
      IMGFLIP_USERNAME: ""
      IMGFLIP_PASSWORD: ""
    timeout: 30000
```

**Tags:** meme, image, creative

**Requirements:** Node >= 18.0.0

**Homepage:** [NPM - meme-mcp](https://www.npmjs.com/package/meme-mcp)

---

### Image Editor
**Official MCP Server** by Truffle AI

Comprehensive image processing and manipulation tools.

```yaml
mcpServers:
  image-editor:
    type: stdio
    command: uvx
    args: ["truffle-ai-image-editor-mcp"]
    timeout: 30000
```

**Tags:** image, edit, opencv, pillow

**Requirements:** Python >= 3.10

**Homepage:** [GitHub - Truffle AI MCP Servers](https://github.com/truffle-ai/mcp-servers)

---

### Music Creator
**Official MCP Server** by Truffle AI

Create, analyze, and transform music and audio.

```yaml
mcpServers:
  music-creator:
    type: stdio
    command: uvx
    args: ["truffle-ai-music-creator-mcp"]
    timeout: 30000
```

**Tags:** audio, music, effects

**Requirements:** Python >= 3.10

**Homepage:** [GitHub - Truffle AI MCP Servers](https://github.com/truffle-ai/mcp-servers)

---

### ElevenLabs
**Official MCP Server** by ElevenLabs

Text-to-speech and voice synthesis using ElevenLabs API.

```yaml
mcpServers:
  elevenlabs:
    type: stdio
    command: uvx
    args: ["elevenlabs-mcp"]
    env:
      ELEVENLABS_API_KEY: ""
    timeout: 30000
```

**Tags:** tts, voice, audio, synthesis

**Requirements:** Python >= 3.10

**Homepage:** [GitHub - ElevenLabs MCP](https://github.com/elevenlabs/elevenlabs-mcp)

---

### Gemini TTS
**Official MCP Server** by Truffle AI

Google Gemini Text-to-Speech with 30 prebuilt voices and multi-speaker conversation support.

```yaml
mcpServers:
  gemini-tts:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/gemini-tts-server"]
    env:
      GEMINI_API_KEY: ""
    timeout: 60000
```

**Tags:** tts, speech, voice, audio, gemini, multi-speaker

**Requirements:** Node >= 18.0.0

**Homepage:** [GitHub - Truffle AI MCP Servers](https://github.com/truffle-ai/mcp-servers)

---

### Nano Banana
**Official MCP Server** by Truffle AI

Google Gemini 2.5 Flash Image for advanced image generation, editing, and manipulation.

```yaml
mcpServers:
  nano-banana:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/nano-banana-server@0.1.2"]
    env:
      GEMINI_API_KEY: ""
    timeout: 60000
```

**Tags:** image, generation, editing, ai, gemini, nano-banana

**Requirements:** Node >= 18.0.0

**Homepage:** [GitHub - Truffle AI MCP Servers](https://github.com/truffle-ai/mcp-servers)

---

### HeyGen
**Official MCP Server** by HeyGen

Generate realistic human-like audio using HeyGen.

```yaml
mcpServers:
  heygen:
    type: stdio
    command: uvx
    args: ["heygen-mcp"]
    env:
      HEYGEN_API_KEY: ""
    timeout: 30000
```

**Tags:** audio, voice, synthesis, heygen

**Requirements:** Python >= 3.10

**Homepage:** [GitHub - HeyGen MCP](https://github.com/heygen-com/heygen-mcp)

---

### Runway
**Official MCP Server** by Runway

AI-powered creative suite for video and image generation.

```yaml
mcpServers:
  runway:
    type: stdio
    command: npx
    args: ["mcp-remote", "https://mcp.runway.team", "--header", "Authorization: Bearer ${RUNWAY_API_KEY}"]
    env:
      RUNWAY_API_KEY: ""
    timeout: 60000
```

**Tags:** runway, video, generation, ai, creative

**Requirements:** Node >= 18.0.0

**Homepage:** [Runway MCP Server Docs](https://docs.runway.team/api/runway-mcp-server)

---

### Sora
**Official MCP Server** by Truffle AI

AI-powered video generation using OpenAI's Sora technology.

```yaml
mcpServers:
  sora:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/sora-video-server"]
    env:
      OPENAI_API_KEY: ""
    timeout: 60000
```

**Tags:** video, generation, ai, creative

**Requirements:** Node >= 18.0.0

**Homepage:** [GitHub - Truffle AI MCP Servers](https://github.com/truffle-ai/mcp-servers)

---

## Research

### Product Name Scout
**Official MCP Server** by Truffle AI

SERP analysis, autocomplete, dev collisions, and scoring for product names.

```yaml
mcpServers:
  product-name-scout:
    type: stdio
    command: npx
    args: ["-y", "@truffle-ai/product-name-scout-mcp"]
    timeout: 30000
```

**Tags:** research, naming, brand

**Requirements:** Node >= 18.0.0

**Homepage:** [GitHub - Truffle AI MCP Servers](https://github.com/truffle-ai/mcp-servers)

---

### DuckDuckGo Search
**Community MCP Server**

Search the web using DuckDuckGo.

```yaml
mcpServers:
  duckduckgo:
    type: stdio
    command: uvx
    args: ["duckduckgo-mcp-server"]
    timeout: 30000
```

**Tags:** search, web, research

**Requirements:** Python >= 3.10, uv

**Homepage:** [GitHub - DuckDuckGo MCP Server](https://github.com/duckduckgo/mcp-server)

---

### Domain Checker
**Official MCP Server** by Truffle AI

Check domain availability across TLDs.

```yaml
mcpServers:
  domain-checker:
    type: stdio
    command: uvx
    args: ["truffle-ai-domain-checker-mcp"]
    timeout: 30000
```

**Tags:** domains, availability, research

**Requirements:** Python >= 3.10

**Homepage:** [GitHub - Truffle AI MCP Servers](https://github.com/truffle-ai/mcp-servers)

---

### Tavily Search
**Community MCP Server** by Tavily AI

Web search and research using Tavily AI search engine.

```yaml
mcpServers:
  tavily:
    type: stdio
    command: npx
    args: ["-y", "tavily-mcp@0.1.3"]
    env:
      TAVILY_API_KEY: ""
    timeout: 30000
```

**Tags:** search, web, research, ai

**Requirements:** Node >= 18.0.0

**Homepage:** [NPM - tavily-mcp](https://www.npmjs.com/package/tavily-mcp)

---

### Perplexity
**Official MCP Server** by Perplexity AI

AI-powered search engine for real-time web search and research.

```yaml
mcpServers:
  perplexity:
    type: stdio
    command: npx
    args: ["-y", "@perplexity-ai/mcp-server"]
    env:
      PERPLEXITY_API_KEY: ""
      PERPLEXITY_TIMEOUT_MS: "600000"
    timeout: 600000
```

**Tags:** search, web, research, ai

**Requirements:** Node >= 18.0.0

**Homepage:** [GitHub - Perplexity MCP](https://github.com/perplexityai/modelcontextprotocol/tree/main)

---

## Development

### Hugging Face
**Community MCP Server** by LLMindset

Access Hugging Face models and datasets.

```yaml
mcpServers:
  hf:
    type: stdio
    command: npx
    args: ["-y", "@llmindset/mcp-hfspace"]
    timeout: 30000
```

**Tags:** huggingface, models, ai, ml

**Requirements:** Node >= 18.0.0

**Homepage:** [GitHub - mcp-hfspace](https://github.com/llmindset/mcp-hfspace)

---

## Data & Visualization

### ChartJS
**Official MCP Server** by ax-crew

Charting and visualization tool using ChartJS.

```yaml
mcpServers:
  chartjs:
    type: stdio
    command: npx
    args: ["-y", "@ax-crew/chartjs-mcp-server"]
    timeout: 30000
```

**Tags:** chart, visualization, data, chartjs

**Requirements:** Node >= 18.0.0

**Homepage:** [GitHub - ChartJS MCP Server](https://github.com/ax-crew/chartjs-mcp-server)

---

### Rag-lite TS
**Official MCP Server** by FrugalX

A local-first TypeScript retrieval engine for semantic search over static documents.

```yaml
mcpServers:
  rag-lite-ts:
    type: stdio
    command: npx
    args: ["-y", "raglite-mcp"]
    timeout: 30000
```

**Tags:** rag, data, ai

**Requirements:** Node >= 18.0.0

**Homepage:** [GitHub - rag-lite-ts](https://github.com/raglite/rag-lite-ts)

---

### Exa
**Official MCP Server** by Exa

AI-powered web search and research API with semantic search capabilities.

```yaml
mcpServers:
  exa:
    type: http
    url: https://mcp.exa.ai/mcp
    headers: {}
```

**Tags:** rag, data, ai

**Requirements:** Node >= 18.0.0

**Homepage:** [Exa MCP Docs](https://docs.exa.ai/reference/exa-mcp)

---

## Additional Resources

- **[MCP Configuration Guide](../guides/configuring-dexto/mcpConfiguration.md)** - Comprehensive configuration documentation
- [MCP Overview](./overview.md) - Introduction to MCP and quick reference
- [Model Context Protocol documentation](https://modelcontextprotocol.io/introduction) - Official MCP docs
- [MCP reference servers](https://github.com/modelcontextprotocol/servers) - Community server list
- [Contribute your MCP](https://github.com/truffle-ai/dexto/blob/main/CONTRIBUTING.md#1-adding-new-mcps-to-the-webui-registry) - Add to registry
