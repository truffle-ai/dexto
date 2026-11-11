# Synthetic Claude export fixture

All UUIDs, account fields, messages, timestamps, project names and secrets here
are invented. No personal data or downloaded account export is committed.

Anthropic documents requesting a ZIP through Settings → Privacy → Export data:
https://support.claude.com/en/articles/9450526-export-your-claude-data

That page does not publish a complete JSON schema. The observed JSON field shape
(`conversations.json`, structured `chat_messages`, `projects.json` and `docs`) is
cross-checked against the primary open-source consumer's model definitions:
https://github.com/davehaas/claudeExplorer/blob/main/ClaudeExplorer/Models.swift

The fixture intentionally has no conversation-to-Project association: a UUID is
accepted only when explicitly present, never inferred from names. It includes
duplicate legacy/structured message text to catch accidental duplication and
synthetic assignment secrets to verify redaction before preview and upload.

The integration test writes this metadata into a ZIP at runtime and runs the real
CLI command parser, redactor, authentication boundary and fake MCP/Drive server.
The Claude Code companion uses the synthetic Agent SDK JSONL fixture from
`../../test-utils.ts` in a real `~/.claude/projects/<encoded-path>/<session>.jsonl`
directory layout.
