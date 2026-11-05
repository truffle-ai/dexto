---
sidebar_position: 20
title: "Troubleshooting"
---

# Troubleshooting

Common issues and how to resolve them.

## Setup Issues

### API key not working

1. Verify your key is saved in the correct location:
   - Global: `~/.dexto/.env`
   - Project: `.env` in your project root

2. Check the key has the correct format:
   - OpenAI keys start with `sk-`
   - Anthropic keys start with `sk-ant-`
   - Google keys are alphanumeric

3. Verify the key has correct permissions on the provider's dashboard

4. Set the key again in your environment or `~/.dexto/.env`

### Provider not found

- Use a supported provider name from the list:
  - `google`, `groq`, `openai`, `anthropic`, `xai`, `cohere`
  - `openrouter`, `glama`, `litellm`, `openai-compatible`
  - `local`, `ollama`, `vertex`, `bedrock`

### Local model download fails

1. Check available disk space (models are typically 2-8GB)
2. Ensure you have a stable internet connection
3. Try a smaller model variant
4. Choose a different model with `/model` in the interactive CLI

### Setup stuck or frozen

- Press `Ctrl+C` to cancel and restart
- Set a provider key such as `GOOGLE_GENERATIVE_AI_API_KEY` in your environment, or run `dexto login`

## Runtime Issues

### "No API key configured"

Your provider requires an API key that isn't set up yet.

**Solutions:**
1. Run `dexto login` to use Dexto models
2. Set the environment variable directly:
   ```bash
   # For Google Gemini
   export GOOGLE_GENERATIVE_AI_API_KEY=your-key-here

   # For OpenAI
   export OPENAI_API_KEY=your-key-here

   # For Anthropic
   export ANTHROPIC_API_KEY=your-key-here
   ```

### MCP server connection failed

1. Check the MCP server is running
2. Verify the configuration in your agent YAML file
3. Check network connectivity for remote servers
4. Run with `--strict` flag to see detailed connection errors

### Agent not found

1. Check the agent name or path is correct
2. For custom agents, verify the path exists: `dexto --agent ./path/to/agent.yml`

### Rate-limiting errors

You've hit the provider's rate limits.

**Solutions:**
1. Wait a few moments and retry
2. Switch to a model with higher limits
3. Consider upgrading your API plan
4. Use a different provider temporarily

## Common Questions

### How do I change my provider?

Use `/model` in the interactive CLI, `dexto -m <model>`, or set a different provider key. `dexto login` switches to Dexto models.

### How do I update agents?

After updating Dexto, the next start offers to sync an installed bundled agent with the version the CLI ships.

### Where are settings stored?

| File | Description |
|------|-------------|
| `~/.dexto/preferences.json` | Global preferences (provider, model, mode) |
| `~/.dexto/agents/` | Installed agent configurations |
| `~/.dexto/.env` | API keys (global) |
| `.env` | API keys (project-specific) |

### How do I reset everything?

```bash
# Delete the config directory
rm -rf ~/.dexto
```

### How do I see what model I'm using?

In interactive mode, run `/model current` or `/config` to see your current configuration.

### Can I use multiple providers?

Yes! You can:
- Switch providers with `/model` or a different provider key
- Use different providers per agent (configure in agent YAML)
- Override the model for a single session: `dexto -m gpt-5`

## Getting Help

If your issue isn't covered here:

1. Check the [full documentation](/)
2. Search [GitHub Issues](https://github.com/truffle-ai/dexto/issues)
3. Open a new issue with:
   - Dexto version (`dexto --version`)
   - Operating system
   - Steps to reproduce
   - Error messages (if any)
