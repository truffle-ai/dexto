# Sports Analytics Agent

A specialized Dexto agent for NBA statistics and basketball analytics. This agent connects to the balldontlie API via their MCP server, providing comprehensive access to player stats, team performance, game results, and historical NBA data.

## What You Get
- Complete NBA player statistics and biographical data
- Team standings, rosters, and historical performance
- Game results, box scores, and schedules
- Advanced basketball analytics and metrics
- Historical data across multiple NBA seasons
- Player comparison and trend analysis capabilities

## Requirements
- `BALLDONTLIE_API_KEY` - API key from [balldontlie.io](https://www.balldontlie.io/)
- `OPENAI_API_KEY` - OpenAI API key for the LLM
- Internet connection to access the balldontlie MCP server

## Getting Your API Key

1. Visit [https://www.balldontlie.io/](https://www.balldontlie.io/)
2. Sign up for an account (free tier available)
3. Navigate to your dashboard to get your API key
4. Export it in your shell:
   ```bash
   export BALLDONTLIE_API_KEY="your-api-key-here"
   ```

Alternatively, add it to your `.env` file in the project root:
```bash
BALLDONTLIE_API_KEY=your-api-key-here
```

## Run the Agent

```bash
npm start -- --agent agents/sports-analytics-agent/sports-analytics-agent.yml
```

Or if using the global Dexto CLI:
```bash
dexto chat --agent agents/sports-analytics-agent/sports-analytics-agent.yml
```

Once connected, you can start asking questions about NBA statistics, players, teams, and games.

## Example Queries

**Player Statistics:**
- "Show me LeBron James's career statistics"
- "Who are the top scorers in the 2023-24 season?"
- "What's Stephen Curry's three-point percentage this year?"

**Team Analysis:**
- "What are the current NBA standings?"
- "Show me the Lakers' record this season"
- "Which teams have the best defensive ratings?"

**Player Comparisons:**
- "Compare Michael Jordan and Kobe Bryant's career stats"
- "Who's a better shooter: Stephen Curry or Damian Lillard?"
- "Compare the top 5 rebounders in the league"

**Game Information:**
- "What was the score of the last Lakers vs Warriors game?"
- "Show me the upcoming schedule for the Celtics"
- "What were the highest scoring games this week?"

**Trend Analysis:**
- "How has Luka Doncic's scoring improved over his career?"
- "Show me the progression of three-point shooting in the NBA over the last 10 years"
- "Which player has improved the most this season?"

## Features

### Intelligent Analytics
The agent doesn't just return raw data - it provides context and insights:
- Explains what statistics mean in basketball terms
- Identifies trends and patterns in performance
- Compares players across eras with appropriate context
- Highlights statistical anomalies and career milestones

### Data Coverage
- **Current Season**: Up-to-date stats and standings
- **Historical Data**: Access to past seasons and career statistics
- **Advanced Metrics**: Beyond basic stats, includes efficiency ratings and advanced analytics
- **Game-Level Detail**: Box scores, play-by-play, and game outcomes

### Memory & Context
The agent uses Dexto's memory system to remember:
- Your favorite teams and players
- Previous analyses and comparisons you've requested
- Context from your conversation for more natural follow-up questions

## Configuration

The agent uses HTTP transport to connect to the balldontlie MCP server. Key configuration details:

```yaml
mcpServers:
  balldontlie:
    type: http
    url: https://mcp.balldontlie.io/mcp
    headers:
      Authorization: $BALLDONTLIE_API_KEY
    timeout: 30000
    connectionMode: strict
```

## Troubleshooting

**"Authorization failed" error:**
- Verify your `BALLDONTLIE_API_KEY` is set correctly
- Check that your API key is active on balldontlie.io
- Ensure you're using the latest agent configuration

**"Connection timeout" error:**
- Check your internet connection
- The balldontlie MCP server might be temporarily unavailable
- Try increasing the timeout value in the agent config

**"No data found" for a query:**
- Verify player/team names are spelled correctly
- Some historical data might not be available for all seasons
- Try rephrasing your query or being more specific

## Data Source

This agent uses the [balldontlie API](https://www.balldontlie.io/), a comprehensive NBA statistics API that provides:
- Official NBA statistics
- Real-time updates during games
- Historical data going back decades
- Both traditional and advanced metrics

## Notes

- The agent focuses on NBA data (no other leagues currently supported)
- Free tier API keys may have rate limits - the agent handles this gracefully
- Some advanced analytics require specific data availability by season
- The agent provides basketball context but is not a substitute for watching the games! 🏀
