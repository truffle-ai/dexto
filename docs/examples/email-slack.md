---
title: "Email to Slack: Automated Email Summaries"
---

import ExpandableImage from '@site/src/components/ExpandableImage';

# Email to Slack: Automated Email Summaries

Automatically summarize emails and send highlights to Slack channels.

**Task:** `Summarize emails and send highlights to Slack`

```bash
dexto --agent ./agents/examples/email_slack.yml
```

<ExpandableImage src="/assets/email_slack_demo.gif" alt="Email to Slack Demo" title="Email to Slack: Automated Email Summaries" width={900} />

## What it does

This example demonstrates multi-tool orchestration:
1. Connect to email via Gmail MCP server
2. Fetch recent unread emails
3. Summarize content using LLM
4. Send formatted summaries to Slack channel
5. Mark emails as read

## Requirements

- Gmail access via Composio (SSE endpoint)
- Slack MCP server (`@modelcontextprotocol/server-slack`)
- Composio API setup for Gmail
- Slack bot token
- Agent configuration file

## Setup

1. **Configure Gmail access:**
   - Set up Composio for Gmail integration
   - Get your Composio endpoint URL
   - Configure authentication

2. **Get Slack token:**
   - Create a Slack app
   - Add bot token scopes: `chat:write`, `channels:read`
   - Set `SLACK_BOT_TOKEN` and `SLACK_TEAM_ID` environment variables

3. **Configure agent:**
```yaml
# agents/examples/email_slack.yml
mcpServers:
  gmail:
    type: http
    url: "your-composio-url"

  slack:
    type: stdio
    command: npx
    args: ['-y', '@modelcontextprotocol/server-slack']
    env:
      SLACK_BOT_TOKEN: $SLACK_BOT_TOKEN
      SLACK_TEAM_ID: $SLACK_TEAM_ID
```

4. **Run the agent:**
```bash
dexto --agent ./agents/examples/email_slack.yml
```

## Customization

Modify the agent to:
- Filter emails by sender or subject
- Custom summary formats
- Schedule periodic checks
- Route to different Slack channels based on content
- Add reactions or threading

## Learn More

- [MCP Slack Server](https://github.com/modelcontextprotocol/servers/tree/main/src/slack)
- [Composio Integration](https://composio.dev/)
- [Agent Configuration](/docs/guides/configuring-dexto/overview)
- [MCP Integration Guide](/docs/mcp/overview)
