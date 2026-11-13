---
sidebar_position: 11
---

# Tools

Tools are configured via the `tools:` list (tool factories). Each entry selects a factory by
`type` and provides factory-specific configuration.

If you omit `tools`, Dexto uses the active image defaults.

:::tip Reference
See **[agent.yml → Tools](./agent-yml.md#tools)** for the full schema.
:::

## Example

```yaml
tools:
  - type: builtin-tools
    enabledTools:
      - ask_user
      - skill_load
      - delegate_to_url

  - type: filesystem-tools
    allowedPaths: ["."]
    blockedPaths: [".git", "node_modules/.bin", ".env"]
    enableBackups: false

  - type: process-tools
    securityLevel: moderate

  - type: todo-tools

  - type: plan-tools
    basePath: "${{dexto.project_dir}}/plans"

  - type: lifecycle-tools
    enabledTools:
      - search_history
      - view_logs
      - memory_list
```

## Command environment

:::info Upgrading to 1.17
Shell commands used to inherit Dexto's whole environment. They no longer do. A command that read an
API key (or any other variable) from the environment must now be given it, as shown below. Local MCP
stdio servers changed the same way; see
[MCP configuration](./mcpConfiguration.md#what-a-stdio-server-can-see).

SDK-hosted servers also bind to loopback by default; see the [hosting guide](../deployment.md)
to allow network access with an API key. Server Origin and Host checks may also require
[configuration](../deployment.md#origin-and-host-checks).
:::

Commands run by `process-tools` (`bash_exec` and the other process tools, including commands run
through a workspace, which is the CLI default) do not inherit Dexto's environment. A command starts
with a small allowlist of host variables:

- `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`
- `LANG`, `LANGUAGE`, `LC_*`, `TERM`, `COLORTERM`, `TZ`
- `TMPDIR`, `XDG_*`
- CA bundle variables: `SSL_CERT_FILE`, `SSL_CERT_DIR`, `CURL_CA_BUNDLE`, `REQUESTS_CA_BUNDLE`,
  `NODE_EXTRA_CA_CERTS`
- proxy variables: `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (upper or lower case)
- on Windows, the system variables commands need to start (`SYSTEMROOT`, `COMSPEC`, `PATHEXT`,
  `USERPROFILE`, `APPDATA`, `TEMP` and similar)

Model provider keys, the server key and every other host variable are not visible to commands. To
add variables, set them on the `process-tools` entry:

```yaml
tools:
  - type: process-tools
    passEnvironment: [GH_TOKEN, SSH_AUTH_SOCK]   # forward the host's value under the same name
    environment:
      MY_FLAG: "1"                               # a literal value
```

| Key | What it does |
| --- | --- |
| `passEnvironment` | Names of host variables to forward to commands. A name that is not set on the host is skipped. |
| `environment` | Variables to set to a literal value. They are not expanded from the host, so `$VAR` is passed as written. |

`environment` wins over a forwarded variable of the same name, and an `env` given on a single command
wins over both.

:::warning
Anything in `passEnvironment` or `environment` reaches **every** command the agent runs, including
ones the model writes. List only what the agent should be able to use, and prefer a narrowly scoped
token over a broad one.
:::

## Notes

- Use `enabled: false` on any entry to disable that tool factory.
- Local tool IDs are unprefixed (e.g. `read_file`, `bash_exec`).
- MCP tool IDs are prefixed as `mcp--<server_name>--<tool_name>`. In `permissions.toolPolicies`,
  you can also use `mcp--<tool_name>` to match any MCP server that exposes that tool.

## Private addresses in `delegate_to_url` and webhooks

`delegate_to_url` and webhook URLs may point at loopback and private addresses (`localhost`,
`127.0.0.1`, `10.x`, `192.168.x`, and similar). This is a decision, not an oversight: delegating to
an A2A agent running on the same machine and posting events to a local service are the normal uses
of both, and they would stop working if private addresses were blocked by default. Both still refuse
the URLs that have no legitimate use here: anything but http or https, credentials in the URL, and
cloud metadata addresses and host names (`169.254.169.254` and the like), including names that
resolve to one when the connection is made. The cost of allowing the rest is that the model chooses
the `delegate_to_url` URL as a tool argument (the tool's approval policy still applies), and whoever
can register a webhook chooses its target, so either can aim a request at services on the host's own
network. A deployment that exposes an agent to untrusted input should keep tool approval on for
`delegate_to_url` and not run on a network with unauthenticated internal services. There is no setting to block private
addresses; we add one only if a hosted use needs it (DEXTO-2745).
