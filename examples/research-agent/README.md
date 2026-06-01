# Deep Research Agent

A powerful research agent that conducts thorough, multi-step investigations on any topic using web search, web scraping, and persistent memory.

## Features

- **Semantic Web Search** - Uses Exa AI for intelligent, context-aware search
- **Deep Web Scraping** - Extracts detailed content from web pages via Puppeteer
- **Persistent Memory** - Remembers key findings across research sessions
- **Research Reports** - Saves comprehensive findings to files
- **Multi-Source Synthesis** - Cross-references information from multiple sources

## Quick Start

### Option 1: Run with Dexto CLI

```bash
# Navigate to this directory
cd examples/research-agent

# Create output directory for research files
mkdir -p research-output

# Run the agent
dexto run agent-config.yml
```

### Option 2: Run from anywhere

```bash
# Run directly pointing to the config
dexto run path/to/examples/research-agent/agent-config.yml
```

## Configuration

### Required Environment Variables

```bash
# Set your LLM API key (default uses Anthropic)
export ANTHROPIC_API_KEY=your-api-key

# Or use OpenAI (update llm section in config)
export OPENAI_API_KEY=your-api-key

# Or use Google (update llm section in config)
export GOOGLE_GENERATIVE_AI_API_KEY=your-api-key
```

### Optional: Additional Search Providers

For enhanced search capabilities, you can enable additional providers by uncommenting them in `agent-config.yml`:

```bash
# Tavily - AI-powered research search
export TAVILY_API_KEY=your-tavily-key

# Perplexity - Real-time AI search
export PERPLEXITY_API_KEY=your-perplexity-key

# Firecrawl - Advanced web scraping
export FIRECRAWL_API_KEY=your-firecrawl-key
```

## Example Research Tasks

Once the agent is running, try these research prompts:

### Market Research
```
Research the current state of the electric vehicle market in 2024.
Include market size, major players, recent trends, and future predictions.
```

### Technical Deep Dive
```
Investigate the differences between REST and GraphQL APIs.
Include pros/cons, use cases, and real-world adoption examples.
```

### Competitive Analysis
```
Research the top 5 project management tools (Asana, Monday, Notion, etc).
Compare features, pricing, and user reviews.
```

### Trend Analysis
```
Research the impact of AI on software development practices.
Focus on code generation, testing, and developer productivity.
```

## How It Works

1. **Query Understanding** - The agent analyzes your research question and plans an approach
2. **Information Gathering** - Uses web search and scraping to collect relevant information
3. **Source Tracking** - Maintains citations and source URLs for all findings
4. **Memory Storage** - Saves key findings to memory for future reference
5. **Synthesis** - Combines information from multiple sources into coherent insights
6. **Reporting** - Presents findings in a structured format with sources

## Research Output

Research reports are saved to the `research-output/` directory. You can customize this path in the filesystem MCP server configuration.

## Memory

The agent uses persistent memory to:
- Track research progress across sessions
- Remember key findings and sources
- Build on previous research when exploring related topics

Memory is stored in SQLite and persists between sessions.

## Customization

### Using a Different LLM

Edit the `llm` section in `agent-config.yml`:

```yaml
llm:
  provider: openai
  model: gpt-4.1
  apiKey: $OPENAI_API_KEY
```

### Adding More Search Providers

Uncomment the additional MCP servers in `agent-config.yml` and set the required API keys.

### Adjusting Memory Settings

```yaml
memories:
  enabled: true
  priority: 40
  limit: 50       # Remember more findings
  includeTags: true
```

## Troubleshooting

### "No tools available"
Make sure the MCP servers are starting correctly. Check that Node.js 18+ is installed.

### Puppeteer issues
On first run, Puppeteer may need to download Chromium. This happens automatically but requires internet access.

### Memory not persisting
Ensure the storage configuration is set to `sqlite` (not `in-memory`) for persistence.

## Related Examples

- [Discord Bot](../discord-bot/) - Deploy research capabilities as a Discord bot
- [Telegram Bot](../telegram-bot/) - Deploy as a Telegram bot
- [Agent Delegation](../agent-delegation/) - Use research agent as a specialist in multi-agent systems

## License

MIT
