---
'@dexto/core': patch
---

Redact more secret shapes in logs, span attributes and stringified objects: `sk-` keys that contain hyphens or underscores (Anthropic API keys and OAuth tokens, OpenAI project keys), GitHub, Slack, Google OAuth and Stripe tokens, AWS access key ids, and PEM private key blocks.
