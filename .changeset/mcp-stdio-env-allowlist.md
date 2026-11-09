---
'@dexto/core': minor
---

MCP stdio servers no longer inherit the full host environment. A server now receives only a small allowlist of host variables (`PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LANGUAGE`, `LC_*`, `TERM`, `COLORTERM`, `TMPDIR`, `TZ`, `XDG_*`, CA bundle and proxy variables, and the Windows system variables), plus the `env` set in its own MCP config. Model provider keys and every other host variable are no longer visible to MCP servers. `PATH` is still passed, so `npx` and `node` servers start as before.

If a server relied on an inherited variable, give it the variable in one of two ways. Set it under the server's `env`, with an explicit value or a `$VAR` reference that Dexto expands from the host when the config loads. Or name the host variable under the new per-server `passEnvironment` list, which forwards the host's value. For example, a GitHub server that needs `GITHUB_TOKEN`:

```yaml
mcpServers:
    github:
        type: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-github']
        passEnvironment: [GITHUB_TOKEN]
```

`passEnvironment` hands the named variables to that server only, so list just what the server should be able to use. A value in `env` overrides a forwarded variable of the same name.
