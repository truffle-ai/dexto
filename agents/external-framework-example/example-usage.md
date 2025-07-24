# Example Usage Guide

This guide provides practical examples of using the Saiki + LangChain integration.

## Prerequisites

1. Install dependencies: `npm install`
2. Set environment variable: `export OPENAI_API_KEY="your_key"`
3. Ensure you're in the project root directory

## Example 1: Basic LangChain Integration

### Scenario: Mathematical Problem Solving

**Command:**
```bash
saiki --agent ./agents/external-framework-example/saiki-agent-with-langchain.yml "Use LangChain to solve this math problem: What is 2^10 + 15 * 3?"
```

**Expected Flow:**
1. Saiki agent receives the request
2. Identifies that LangChain's `calculate_math` tool is appropriate
3. Calls the LangChain MCP server with the mathematical expression
4. LangChain processes the calculation using its LLM
5. Returns the result to Saiki
6. Saiki presents the final answer

**Sample Response:**
```
I'll use LangChain to solve this mathematical problem for you.

Using the calculate_math tool with LangChain...

Result: 2^10 + 15 * 3 = 1024 + 45 = 1069

The calculation breaks down as:
- 2^10 = 1024 (2 raised to the 10th power)
- 15 * 3 = 45
- Total: 1024 + 45 = 1069
```

## Example 2: Text Analysis Workflow

### Scenario: Analyze a Document and Save Results

**Command:**
```bash
saiki --agent ./agents/external-framework-example/saiki-agent-with-langchain.yml "Read the README.md file, analyze its sentiment and topics using LangChain, then save the analysis to a file called 'analysis-report.txt'"
```

**Expected Flow:**
1. Saiki reads the README.md file using filesystem tools
2. Passes the content to LangChain's `analyze_text` tool
3. LangChain performs sentiment and topic analysis
4. Saiki receives the analysis results
5. Saiki saves the results to a new file
6. Provides a summary of the analysis

**Sample Response:**
```
I'll help you analyze the README.md file using LangChain and save the results.

First, let me read the README.md file...

Now I'll use LangChain to analyze the text for sentiment and topics...

Analysis Results:
- Sentiment: Positive (confidence: 85%)
- Key Topics: AI agents, MCP protocol, Saiki framework, documentation
- Summary: The document is a comprehensive guide for the Saiki AI agent framework, explaining its features, setup, and usage with a positive and informative tone.

I've saved the detailed analysis to 'analysis-report.txt' for your reference.
```

## Example 3: Creative Content Generation

### Scenario: Generate a Story and Format as HTML

**Command:**
```bash
saiki --agent ./agents/external-framework-example/saiki-agent-with-langchain.yml "Use LangChain to write a short story about a robot learning to paint, then create an HTML file with the story"
```

**Expected Flow:**
1. Saiki calls LangChain's `creative_write` tool
2. LangChain generates a creative story
3. Saiki receives the story content
4. Saiki creates an HTML file with the story
5. Provides the file location and preview

**Sample Response:**
```
I'll use LangChain to create a creative story about a robot learning to paint.

Using LangChain's creative writing capabilities...

Story generated! Now I'll create an HTML file with the story...

I've created 'robot-painting-story.html' with the following content:

<!DOCTYPE html>
<html>
<head>
    <title>Robot Learning to Paint</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #333; }
        .story { line-height: 1.6; }
    </style>
</head>
<body>
    <h1>Robot Learning to Paint</h1>
    <div class="story">
        [Generated story content here...]
    </div>
</body>
</html>

The story explores themes of creativity, learning, and the intersection of technology and art.
```

## Example 4: Multi-step Workflow

### Scenario: Web Research + Analysis + Report Generation

**Command:**
```bash
saiki --agent ./agents/external-framework-example/saiki-agent-with-langchain.yml "Search the web for information about AI agent frameworks, use LangChain to analyze the findings and create a summary, then save it as a markdown report"
```

**Expected Flow:**
1. Saiki uses Puppeteer to search the web
2. Collects information about AI agent frameworks
3. Passes the collected data to LangChain for analysis
4. LangChain performs comprehensive analysis
5. Saiki formats the results as a markdown report
6. Saves the report to a file

**Sample Response:**
```
I'll help you research AI agent frameworks, analyze the findings with LangChain, and create a comprehensive report.

First, let me search the web for information about AI agent frameworks...

Now I'll use LangChain to analyze the collected information and create a summary...

Analysis complete! I've created a comprehensive markdown report with the following sections:
- Overview of AI Agent Frameworks
- Key Features and Capabilities
- Comparison Analysis
- Trends and Future Directions
- Recommendations

The report has been saved as 'ai-frameworks-report.md' and includes:
- Detailed analysis of 5 major frameworks
- Feature comparison matrix
- Market trends and insights
- Strategic recommendations
```

## Example 5: Error Handling and Recovery

### Scenario: Handling API Errors Gracefully

**Command:**
```bash
saiki --agent ./agents/external-framework-example/saiki-agent-with-langchain.yml "Use LangChain to analyze this text: 'This is a test message for sentiment analysis'"
```

**If LangChain server is not running:**
```
I'll use LangChain to analyze the sentiment of that text.

Attempting to connect to LangChain MCP server...

I encountered an issue connecting to the LangChain server. This could be due to:
1. The LangChain MCP server not being started
2. Missing dependencies
3. Configuration issues

To resolve this:
1. Ensure you've run 'npm install' in the external-framework-example directory
2. Check that OPENAI_API_KEY is set correctly
3. Try running the LangChain server directly: node langchain-mcp-server.js

Would you like me to try a different approach or help you troubleshoot the connection?
```

## Example 6: Framework Comparison

### Scenario: Compare Saiki vs LangChain Capabilities

**Command:**
```bash
saiki --agent ./agents/external-framework-example/saiki-agent-with-langchain.yml "Create a comparison document showing the strengths of Saiki vs LangChain, using both frameworks to demonstrate their capabilities"
```

**Expected Flow:**
1. Saiki uses its own capabilities to gather information about Saiki
2. Uses LangChain to research and analyze LangChain
3. Combines both analyses to create a comprehensive comparison
4. Demonstrates the power of multi-framework orchestration

**Sample Response:**
```
I'll create a comprehensive comparison of Saiki and LangChain by leveraging both frameworks' capabilities.

Let me use LangChain to research and analyze LangChain's features...

Now I'll use Saiki's capabilities to gather information about Saiki's features...

Combining the analyses from both frameworks, I've created 'framework-comparison.md' with:

## Saiki Strengths (analyzed by Saiki):
- MCP-native architecture
- Multi-interface support (CLI, Web, Discord, Telegram)
- Built-in orchestration capabilities
- Config-driven agent development

## LangChain Strengths (analyzed by LangChain):
- Rich ecosystem of components
- Advanced chain and agent patterns
- Extensive tool integrations
- Strong developer community

## Framework Interoperability:
This comparison itself demonstrates the power of connecting different AI frameworks through MCP!
```

## Troubleshooting Examples

### Issue: LangChain Server Connection Failed

**Symptoms:** Error messages about connection timeouts or server not found

**Solutions:**
1. Check if dependencies are installed: `npm install`
2. Verify API key: `echo $OPENAI_API_KEY`
3. Test server directly: `node langchain-mcp-server.js`
4. Check file permissions: `chmod +x langchain-mcp-server.js`

### Issue: Tool Not Found

**Symptoms:** "Tool not available" or "Unknown tool" errors

**Solutions:**
1. Verify MCP server is connected: Check Saiki logs
2. Restart Saiki with the correct agent configuration
3. Check server configuration in the YAML file

### Issue: Poor Performance

**Symptoms:** Slow responses or timeouts

**Solutions:**
1. Increase timeout values in the YAML configuration
2. Check network connectivity for API calls
3. Consider using a more powerful LLM model
4. Implement caching for repeated operations

## Best Practices

1. **Start Simple**: Begin with basic LangChain tools before complex workflows
2. **Error Handling**: Always provide fallback options when external services fail
3. **Resource Management**: Clean up temporary files and connections
4. **Logging**: Use verbose mode for debugging: `--verbose`
5. **Testing**: Test individual components before complex orchestration

## Next Steps

1. **Custom Tools**: Add your own specialized tools to the LangChain server
2. **Other Frameworks**: Try connecting AutoGen, CrewAI, or other frameworks
3. **Production Use**: Adapt the example for production deployment
4. **Performance Optimization**: Implement caching and connection pooling 