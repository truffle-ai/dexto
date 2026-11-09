---
'dexto': minor
---

**Upgrade note: local MCP stdio servers and shell commands no longer inherit your whole environment.** If an MCP server or a command the agent runs read an API key (or any other variable) from the environment, you must now give it that variable. Without it the server or command starts without the key and fails, or does less than before.

Both now receive only a small allowlist of host variables (`PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LANGUAGE`, `LC_*`, `TERM`, `COLORTERM`, `TMPDIR`, `TZ`, `XDG_*`, CA bundle and proxy variables, and the Windows system variables), plus whatever your config names. Model provider keys and every other host variable are no longer visible to them. `PATH` is still passed, so `npx` and `node` servers start as before.

**MCP stdio servers.** Forward a host variable with `passEnvironment`, or set it under `env` (a `$VAR` reference is expanded from the host when the config loads):

```yaml
mcpServers:
    github:
        type: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-github']
        passEnvironment: [MY_API_KEY]
        # or: env: { MY_API_KEY: $MY_API_KEY }
```

Remote `http` and `sse` servers are not affected: they run elsewhere and never saw your environment.

**Shell commands** (`bash_exec` and the other process tools, including commands run through a workspace, which is the CLI default). Forward a host variable with `passEnvironment`, or set a literal value with `environment`, on the `process-tools` entry:

```yaml
tools:
    - type: process-tools
      passEnvironment: [GH_TOKEN]
      environment:
          MY_FLAG: '1'
```

`environment` values are literal strings and are not expanded from the host. `passEnvironment` hands the variable to every command the agent runs, so list only what the agent should be able to use.

See [MCP configuration](https://cli.dexto.ai/docs/guides/configuring-dexto/mcpConfiguration#what-a-stdio-server-can-see) and [Tools: command environment](https://cli.dexto.ai/docs/guides/configuring-dexto/tools#command-environment).
