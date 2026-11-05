---
'dexto': minor
'@dexto/agent-management': patch
'@dexto/core': patch
'@dexto/tui': patch
'@dexto/image-bundler': patch
---

`dexto` 2.0 drops the 1.x local-agent commands: `setup`, `connect`, `agents`, `which`, `init`, `create-app`, `init-app`, `image`, `create-image`, `plugin`, `mcp`, `search`, `--mode web|server|mcp` (with the embedded Web UI and the Docker server image), `--skip-setup`, `--no-auto-install`, `--image`, `--dev` and `--port`. The interactive chat, `dexto run`, `chat`, `upgrade`, `uninstall` and the cloud commands stay. The first start needs a provider key in the environment or `dexto login` (signed in, it starts on Dexto models) instead of opening setup. Hints in other packages no longer name the removed commands. packages/cli/CLI.md maps each removed command to its replacement.
