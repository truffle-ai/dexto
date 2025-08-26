# Product Name Research Agent

An AI agent specialized in comprehensive product name research and brand validation. Combines domain availability checking, search engine analysis, developer platform collision detection, and competitive intelligence to provide thorough name validation.

## 📖 Tutorial

For a complete walkthrough of building and using this agent, see the [Product Name Scout Agent Tutorial](../../docs/docs/tutorials/product-name-scout-agent.md).

## Features

- **Domain Availability**: Check multiple TLD extensions (.com, .io, .app, .dev, etc.)
- **SERP Competition Analysis**: Analyze search engine results for brand competition
- **Autocomplete Intelligence**: Assess name recognition and spelling patterns
- **Developer Platform Collision Detection**: Check GitHub, npm, and PyPI for conflicts
- **Competitive Research**: DuckDuckGo-powered market intelligence
- **Comprehensive Scoring**: Weighted algorithms for brand viability assessment
- **Batch Comparison**: Compare multiple names with detailed scoring breakdown

## Prerequisites

Ensure you have the domain checker MCP server available:

```bash
# Install the domain checker MCP server
uvx truffle-ai-domain-checker-mcp
```

## Usage

### Start the Agent

```bash
# From the dexto root directory
dexto -a agents/product-name-researcher/product-name-researcher.yml
```

### Example Interactions

**Single Product Name Research:**
```
User: I want to research the name "CloudSync" for my new file sync product
Agent: [Performs comprehensive research including domain availability, trademark search, social media handles, and competitive analysis]
```

**Compare Multiple Names:**
```
User: Help me choose between "DataFlow", "InfoStream", and "SyncHub" for my data management tool
Agent: [Compares all three names across multiple criteria and provides recommendations]
```

**Domain-Focused Research:**
```
User: Check domain availability for "myawesomeapp" across all major TLDs
Agent: [Uses domain checker to verify availability across .com, .net, .org, .io, .app, etc.]
```

## Configuration

The agent uses:
- **Domain Checker MCP Server**: For domain availability checking
- **DuckDuckGo MCP Server**: For web search and competitive research
- **Product Name Scout MCP Server**: For SERP analysis, autocomplete, and developer collision detection

## Research Report

The agent generates comprehensive reports including:

1. **Domain Availability Summary**
   - Available domains with recommendations
   - Pricing information where available
   - Alternative TLD suggestions

2. **Trademark Analysis**
   - Similar trademarks found
   - Risk assessment
   - Recommendations for trademark clearance

3. **Developer Platform Analysis**
   - GitHub repository conflicts
   - NPM package collisions
   - PyPI package conflicts

4. **Competitive Landscape**
   - Existing products with similar names
   - Market positioning analysis
   - Differentiation opportunities

5. **Overall Recommendation**
   - Scoring across all criteria
   - Risk assessment
   - Next steps recommendations

## Tips for Best Results

- **Be specific about your product**: Include the product category and target market
- **Provide alternatives**: Give multiple name options for comparison
- **Consider your priorities**: Mention if domain availability, trademark clearance, or developer platform conflicts are most important
- **Think internationally**: Consider how the name works in different languages and markets