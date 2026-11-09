---
'@dexto/tools-process': minor
'@dexto/core': minor
'@dexto/image-local': minor
---

Shell commands now start with a small environment instead of the full host environment, including commands run through a workspace (the CLI default). Commands receive only: `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `LANG`, `LANGUAGE`, `LC_*`, `TERM`, `COLORTERM`, `TMPDIR`, `TZ`, `XDG_*`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, `CURL_CA_BUNDLE`, `REQUESTS_CA_BUNDLE`, `NODE_EXTRA_CA_CERTS`, `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (proxy names in upper or lower case), and the Windows system variables. Model provider keys, the server key and every other host variable are no longer visible to commands.

If a command relied on another inherited variable, either name it under `passEnvironment` to forward the host's value, or set a value under `environment`, in the `process-tools` config:

```yaml
tools:
    - type: process-tools
      passEnvironment: [GH_TOKEN, GITHUB_TOKEN, SSH_AUTH_SOCK]
      environment:
          MY_FLAG: '1'
```

`passEnvironment` forwards credentials such as `GH_TOKEN`, `GITHUB_TOKEN` and `SSH_AUTH_SOCK` to every command the agent runs, so list only what the agent should be able to use. `environment` values are literal strings and are not expanded from the host. `environment` and per-call `env` now also apply to commands run through a workspace.

Telemetry spans on agent classes no longer record method arguments by default. A class that wants them opts in with `captureArguments: true`.
