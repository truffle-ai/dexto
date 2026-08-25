# Aeon Agent

Operate an [Aeon](https://github.com/aeonfun/aeon) autonomous agent instance from chat. Aeon runs your own skills on a schedule in GitHub Actions - a skill is a `skills/<name>/SKILL.md` file, and `aeon.yml` declares which skills run and when. This agent connects the bundled `@truffle-ai/github-mcp-server` (to operate your instance repo) and a filesystem server (to read and edit `aeon.yml` and skills), so it can stand up an instance, schedule and edit skills, and debug runs.

## Features
- Start an instance from scratch and get one real run live
- Enable, install, and schedule skills; reschedule cadence
- Edit what an existing skill does
- Debug a skill that will not fire
- Set the `STRATEGY.md` north star and `soul/` voice
- Turn repeated manual work into a scheduled skill

## Setup
1. Install dependencies: `npm install`
2. Set environment variables: `export ANTHROPIC_API_KEY=your-key`
3. Run the agent: `dexto --agent agents/aeon-agent/aeon-agent.yml`

On first run the GitHub MCP server opens a one-time device-code OAuth prompt to authorize repository access; no personal access token is required for most users.

## Usage Examples
- "Set up an Aeon instance from scratch and get one real run to fire."
- "Show me my Aeon skills, then enable one and set its schedule in aeon.yml."
- "One of my skills did not run - help me find out why and fix it."

## Requirements
- Node.js >= 18 with access to `npx`
- A GitHub account with access to your Aeon instance repository
- `ANTHROPIC_API_KEY` (or another configured LLM key) exported in your shell

Repo: https://github.com/aeonfun/aeon - Homepage: https://aeon.fun
