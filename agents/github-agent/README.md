# GitHub Integration Agent

Bring GitHub context into any workspace. This agent starts the `@truffle-ai/github-mcp-server` in `stdio` mode so the assistant can explore repositories, manage pull requests, and automate GitHub project workflows directly from chat.

## What You Get
- Full coverage of GitHub toolsets (repos, pull requests, issues, actions, discussions, notifications, security, projects, and more)
- Automatic OAuth device-flow login with cached tokens, no personal access token required for most users
- Safe-guarded write operations (issues, PRs, workflow runs, comments, etc.) that the agent confirms before executing
- Optional read-only or scoped toolsets to limit the surface area for sensitive environments

## Requirements
- Node.js 18+ with access to `npx`
- A GitHub account with access to the repositories you plan to manage
- Browser access to complete the one-time device-code OAuth prompt (opened automatically)
- `OPENAI_API_KEY` (or another configured LLM key) exported in your shell for the agent

## Run the Agent
```bash
npm start -- --agent agents/github-agent/github-agent.yml
```

The CLI launches `npx -y @truffle-ai/github-mcp-server stdio`. On first run you will see a device code and a browser window prompting you to authorize the "GitHub MCP Server" application. Approving the flow stores an access token at:

```
~/.config/truffle/github-mcp/<host>-token.json
```

Subsequent sessions reuse the cached token unless it expires or you delete the file. Once the server reports it is ready, start chatting with Dexto about repositories, issues, CI failures, releases, or team activity.

## Optional Configuration
You can tailor the underlying MCP server by exporting environment variables before starting Dexto:

- `GITHUB_PERSONAL_ACCESS_TOKEN`: Provide a PAT (with `repo` and `read:user` at minimum) if you need to bypass OAuth or run in headless environments.
- `GITHUB_TOOLSETS="repos,issues,pull_requests,actions"`: Restrict which groups of tools the agent loads. Available groups include `repos`, `issues`, `pull_requests`, `actions`, `notifications`, `discussions`, `projects`, `code_security`, `dependabot`, `secret_protection`, `security_advisories`, `users`, `orgs`, `gists`, `context`, and `experiments`.
- `GITHUB_READ_ONLY=1`: Offer only read-only tools; write operations will be hidden.
- `GITHUB_DYNAMIC_TOOLSETS=1`: Enable on-demand toolset discovery so the model only activates tools as needed.
- `GITHUB_HOST=https://github.mycompany.com`: Point the agent at GitHub Enterprise Server or ghe.com tenants.
- `GITHUB_LOG_FILE=~/github-mcp.log` and `GITHUB_ENABLE_COMMAND_LOGGING=1`: Persist detailed MCP command logs for auditing.
- `GITHUB_CONTENT_WINDOW_SIZE=7500`: Increase the amount of content retrieved for large diffs or logs.

Refer to the upstream [`github-mcp-server`](https://github.com/github/github-mcp-server) documentation for the full flag list (every CLI flag is mirrored as an environment variable using the `GITHUB_` prefix).

## Switching to the Remote GitHub MCP Server (optional)
If you prefer to connect to the GitHub-hosted remote MCP server instead of running the bundled binary, replace the `mcpServers.github` block in `github-agent.yml` with:

```yaml
mcpServers:
  github:
    type: http
    url: https://api.githubcopilot.com/mcp/
    connectionMode: strict
```

You can optionally add `headers` for PAT authentication if your host does not support OAuth. Restart Dexto after saving the change.

## Resetting Authorization
To force a new OAuth login, delete the cached token file (`rm ~/.config/truffle/github-mcp/*-token.json`) and relaunch the agent. The next startup will trigger a fresh device flow.
