---
sidebar_position: 7
---

# Product Name Scout Agent

Learn how to build an AI agent that provides comprehensive product name research and brand validation capabilities. This tutorial shows how to create an agent that can analyze potential product names through search engine analysis, developer platform collision detection, and automated scoring algorithms.

## 🎥 Demo Video

Watch the Product Name Scout Agent in action:

<iframe
  width="100%"
  height="400"
  src="https://www.youtube.com/embed/oReKtfZuHYY"
  title="Product Name Scout Agent Demo"
  frameborder="0"
  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
  allowfullscreen="true"
></iframe>

## What You'll Build

A product name research agent that can:
- Check for domain availability (.com, .ai, .dev, .io, etc.) for your product name
- Analyze search engine results for brand competition across Google, DuckDuckGo, and Brave
- Check autocomplete suggestions to identify spelling and recognition issues
- Detect conflicts on developer platforms (GitHub, npm, PyPI)
- Conduct competitive research and trademark conflict assessment
- Provide a final 1-100 scoring based on all of these factors

## Understanding the Architecture

The product name scout agent follows Dexto's framework design with clear separation of responsibilities:

1. **MCP Servers with tools**: Multiple specialized servers for different aspects of name research. These handle specific research tasks (SERP analysis, domain checking, etc.)
2. **Agent**: Orchestrates complex research workflows and synthesizes findings

This architecture allows the agent to conduct thorough research while maintaining clear, actionable insights.

## MCP Server Code

The core functionality is provided by three MCP servers. To understand the complete MCP server implementations, refer to the [mcp-servers repository](https://github.com/truffle-ai/mcp-servers/tree/main):

- **Product Name Scout Server**: [src/product-name-scout](https://github.com/truffle-ai/mcp-servers/tree/main/src/product-name-scout) - SERP analysis, autocomplete, dev collisions, and scoring
- **Domain Checker Server**: [src/domain-checker](https://github.com/truffle-ai/mcp-servers/tree/main/src/domain-checker) - Domain availability checking via WHOIS and DNS
- **DuckDuckGo Server**: External third-party server for web search capabilities

## Step 1: Setting Up the Project

The product name research agent uses multiple MCP servers for comprehensive analysis:

```
agents/product-name-researcher/
├── product-name-researcher.yml  # Agent configuration
└── README.md                   # Documentation
```

## Step 2: Quick Setup

The agent uses published MCP servers that are automatically installed:

```bash
# From the dexto project root
dexto --agent agents/product-name-researcher/product-name-researcher.yml
```

The agent will automatically download and install all required MCP servers:
- `truffle-ai-domain-checker-mcp` - Domain availability checking
- `duckduckgo-mcp-server` - Web search and competitive research
- `@truffle-ai/product-name-scout-mcp` - Advanced name analysis tools

## Step 3: Understanding the Agent Configuration

The agent is configured in `product-name-researcher.yml`:

```yaml
systemPrompt: |
  You are a specialized Product Name Research Agent focused on helping entrepreneurs, 
  product managers, and marketing teams validate potential product names through 
  comprehensive research. Your expertise combines domain availability checking with 
  competitive landscape analysis and advanced searchability assessment.

mcpServers:
  # Domain availability checking
  domain-checker:
    type: stdio
    command: uvx
    args:
      - truffle-ai-domain-checker-mcp
  
  # Web search for competitive research
  duckduckgo:
    type: stdio
    command: uvx
    args:
      - duckduckgo-mcp-server
  
  # Advanced product name analysis
  product-name-scout:
    type: stdio
    command: npx
    args:
      - "@truffle-ai/product-name-scout-mcp"

llm:
  provider: anthropic
  model: claude-sonnet-4-5-20250929
  apiKey: $ANTHROPIC_API_KEY

permissions:
  mode: auto-approve
```

### Key Components Explained

1. **systemPrompt**: Defines specialized product name research expertise
2. **mcpServers**: Connects to three complementary research tools
3. **permissions**: Auto-approves tools for seamless research workflow
4. **llm**: Configures the language model for intelligent analysis

## Step 4: Available Tools

The product name scout agent provides 9 specialized research tools across three categories:

### Domain Research Tools (3)
- `check_domain` - Check availability of a single domain
- `check_multiple_domains` - Check multiple domains simultaneously
- `check_domain_variations` - Check a base name across multiple TLD extensions

### Advanced Name Analysis Tools (4)
- `check_brand_serp` - Analyze search engine results for brand competition
- `get_autocomplete` - Get search engine autocomplete suggestions
- `check_dev_collisions` - Check for existing projects on GitHub, npm, PyPI
- `score_name` - Comprehensive scoring across multiple brand viability factors

### Competitive Research Tools (2)
- `search` - DuckDuckGo search for competitive analysis and market research
- `get_content` - Extract and analyze content from specific web pages

## Step 5: Research Methodology

The agent follows a systematic approach to product name validation:

### For Single Name Research:
1. **Domain Availability Check**: Verify availability across key TLDs (.com, .io, .app, etc.)
2. **SERP Competition Analysis**: Assess existing brand presence in search results
3. **Autocomplete Pattern Analysis**: Understand search behavior and spelling issues
4. **Developer Platform Conflicts**: Check for existing projects on GitHub, npm, PyPI
5. **Competitive Research**: Search for existing companies/products with similar names
6. **Trademark Assessment**: Search for trademark conflicts and legal issues
7. **Comprehensive Scoring**: Generate overall viability score with detailed breakdown

### For Multiple Name Comparison:
1. **Batch Domain Analysis**: Check all names across key TLD extensions
2. **Parallel Research**: Conduct SERP and collision analysis for each name
3. **Comparison Matrix**: Create comprehensive comparison including all factors
4. **Scoring & Ranking**: Rank names based on availability, conflicts, and strategic value
5. **Final Recommendation**: Provide clear recommendation with detailed reasoning

## Step 6: Running the Agent

Start the product name research agent:

```bash
# From the project root
dexto --agent agents/product-name-researcher/product-name-researcher.yml
```

## Step 7: Testing with Example Prompts

Let's test the agent with realistic product name research scenarios:

### Basic Name Validation
```
"I'm considering 'ZenFlow' as a product name for a productivity app. Can you research this name?"
```

**What happens**: The agent orchestrates a complete research workflow:
1. Checks domain availability for zenflow.com, zenflow.io, etc.
2. Analyzes search competition for "ZenFlow"
3. Checks autocomplete suggestions
4. Searches GitHub, npm, and PyPI for conflicts
5. Provides comprehensive scoring and recommendations

### Domain-Focused Research
```
"Check domain availability for 'CodeCraft' across all major extensions"
```

**What happens**: The agent calls `check_domain_variations` to check .com, .net, .org, .io, .app, .dev, and .tech extensions simultaneously.

### Competitive Analysis
```
"Research existing companies using the name 'DataFlow' and assess trademark risks"
```

**What happens**: The agent combines multiple tools:
- `search` for competitive landscape analysis
- `check_brand_serp` for search presence assessment
- `get_content` to analyze competitor websites
- Synthesizes findings into trademark risk assessment

### Multiple Name Comparison
```
"Compare these three product names for a fintech startup: 'PayEase', 'CashFlow', and 'MoneyBridge'"
```

**What happens**: The agent conducts parallel research on all three names and provides a ranked comparison with detailed scoring breakdown.

### Developer-Focused Research
```
"I'm launching a new JavaScript library. Check if 'ReactFlow' conflicts with existing packages"
```

**What happens**: The agent focuses on `check_dev_collisions` for GitHub and npm, plus domain research for library website.

## Step 8: Understanding the Scoring System

The `score_name` tool uses weighted scoring across multiple factors:

### Scoring Factors (with weights):
- **SERP Emptiness (3x)**: Lower search competition = higher score
- **Spellability (2x)**: Easy to spell and remember names score higher  
- **Autocomplete Behavior (2x)**: Clean autocomplete patterns score higher
- **Developer Collisions (2x)**: Fewer conflicts on dev platforms = higher score
- **Domain Availability (3x)**: More available domains = higher score
- **Trademark Conflicts (2x)**: Lower trademark risk = higher score
- **International Considerations (1x)**: Global usability assessment

### Score Interpretation:
- **80-100**: Excellent name with strong availability and low conflicts
- **60-79**: Good name with minor issues to consider
- **40-59**: Moderate concerns requiring careful evaluation
- **20-39**: Significant conflicts or availability issues
- **0-19**: High-risk name with major obstacles

## Step 9: Example Research Workflow

Here's a complete workflow for researching a product name:

```
User: "Research 'CloudSync' for a file synchronization service"

Agent Response:
"I'll conduct comprehensive research on 'CloudSync' for your file synchronization service. Let me analyze multiple factors:

🔍 DOMAIN AVAILABILITY
[Checks cloudsync.com, cloudsync.io, cloudsync.app, etc.]
- cloudsync.com: ❌ NOT AVAILABLE 
- cloudsync.io: ✅ AVAILABLE
- cloudsync.app: ✅ AVAILABLE

🔍 SEARCH COMPETITION ANALYSIS  
[Analyzes Google search results for 'CloudSync']
- Found ~45,000 results
- Existing competitors in cloud storage space
- Mixed signals on brand conflicts

🔍 DEVELOPER PLATFORM CHECK
[Searches GitHub, npm, PyPI for conflicts]
- GitHub: 12 repositories with 'cloudsync' 
- npm: 3 packages with similar names
- PyPI: 1 existing package

🔍 AUTOCOMPLETE ANALYSIS
[Checks search suggestions]
- Google suggests: 'cloudsync app', 'cloudsync software'
- Shows some existing recognition

📊 COMPREHENSIVE SCORE: 67/100
- Moderate availability with some conflicts
- Strong domain options available (.io, .app)
- Consider alternative: 'SyncCloud' or 'CloudFlow'

💡 RECOMMENDATION: Proceed with caution. While .io and .app domains are available, existing competition suggests trademark research needed. Consider variants like 'SyncStream' or 'CloudVault' for cleaner positioning."
```

## Research Best Practices

### Competitive Research Guidelines:
- Search for exact name matches and close variations
- Research across different industries and markets
- Look for existing trademarks and brand registrations
- Check social media presence and brand mentions
- Consider international markets and global brand presence

### Search Strategy Guidelines:
- Use specific queries: "[name] company", "[name] trademark", "[name] brand"
- Search industry-specific usage: "[name] [industry]", "[name] product"
- Look for legal conflicts: "[name] lawsuit", "[name] trademark dispute"
- Research naming trends in the target industry

## Common Use Cases

- **Startup Name Validation**: Complete due diligence for new company names
- **Product Launch Research**: Validate product names before market entry  
- **Brand Extension Analysis**: Research names for new product lines
- **Trademark Risk Assessment**: Identify potential legal conflicts early
- **Domain Strategy Planning**: Optimize domain portfolio decisions
- **Competitive Intelligence**: Understand market landscape and positioning

---

**Ready for comprehensive name research?** Start the agent and begin validating your product names with professional-grade analysis tools!
