# Skill Anatomy

## Canonical Layout

```text
.agents/skills/<skill-id>/
├── SKILL.md
├── handlers/
├── scripts/
├── mcps/
└── references/
```

## What Goes Where

- `SKILL.md`: Trigger conditions, workflow, and navigation entrypoint.
- `handlers/`: Reusable helper code or structured workflow fragments.
- `scripts/`: Deterministic helpers the agent can run instead of rewriting logic.
- `mcps/`: JSON config fragments for MCP servers used by the skill.
- `references/`: Supporting material the agent should open only when needed, especially larger copied docs, schemas, external references, or long examples.

## Creation Checklist

1. Search existing skills first.
2. Pick a concise kebab-case id and description.
3. Keep actionable workflow in `SKILL.md`; move only larger reference material into `references/`.
4. Add scripts or handlers only when they remove repeated work or improve reliability.
5. Add MCP configs only when the skill truly depends on them.
6. Reference bundled files from `SKILL.md` using relative paths.

## MCP Truthfulness

- `mcps/` stores bundled MCP config, not the MCP implementation itself.
- Only say a skill ships a real MCP when the config points to:
    - a runnable bundled server in the same skill, or
    - a verified external package/command the user asked for
- If you only scaffolded config, describe it as scaffolding or wiring, not implementation.

## Reload Notes

- `skill_create` and `skill_update` write the skill bundle to the canonical workspace root.
- If you edit `SKILL.md`, `mcps/`, `scripts/`, or `references/` with other tools, use `skill_load` to reread the current files.
- Configure runtime MCP servers through normal MCP configuration paths; bundled `mcps/` files are supporting files, not a refresh mechanism.
