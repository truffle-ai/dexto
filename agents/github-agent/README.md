# GitHub Integration Agent

This agent configuration connects Dexto to the GitHub OAuth MCP server so you can browse repositories, triage issues, and collaborate on pull requests without leaving chat.

## Features
- Read repository structure, files, issues, discussions, and pull requests directly from GitHub
- Draft comments, reviews, releases, and task lists with confirmation before anything is posted
- Receive time-aware guidance for project management and collaboration flows

## Prerequisites
- Access to GitHub Copilot with MCP HTTP endpoints enabled
- Ability to complete the OAuth sign-in flow when Dexto requests it (a browser window opens automatically)

## Usage
```bash
npm start -- --agent agents/github-agent/github-agent.yml
```

Once connected, ask the agent for repository insights or collaboration tasks. It will use the GitHub MCP server for all repository interactions.
