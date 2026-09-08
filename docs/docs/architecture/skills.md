---
sidebar_position: 3
---

# Skills contract

Skills are host-owned, first-class capabilities. Core only knows how to list concise routing
metadata and load one exact skill; it does not know where a skill is stored or how a hosted runtime
materializes it.

## Core contract

The public contract in `@dexto/core/skills` is:

```typescript
type SkillSummary = {
    name: string;
    description: string;
};

type LoadedSkill = {
    name: string;
    instructions: string;
    supportingFiles: readonly string[];
    filesLocation: 'hosted' | 'workspace';
    baseDirectory: string | null;
};

interface Skills {
    list(): Promise<readonly SkillSummary[]>;
    load(name: string): Promise<LoadedSkill | null>;
    readFile(name: string, path: string): Promise<string>;
}
```

`name` is the canonical key shown by `list()` and accepted by `skill_load`. Names are exact; there
are no display-name aliases or source precedence rules. Every summary has a non-empty description so
the system prompt can make a useful routing decision without loading full instructions.

`load()` always returns the same shape. Instruction-only skills return an empty
`supportingFiles` array, `filesLocation: 'hosted'`, and `baseDirectory: null`. Workspace-backed
skills report relative supporting-file paths and a workspace `baseDirectory`. The `skill_load` tool
uses `readFile()` for a requested supporting file, so agents do not need a second skill-specific
tool or a Bash-visible hosted directory.

## Ownership and lifecycle

Images provide one `Skills` implementation through `skills.create(context)`. Core injects that
implementation into `DextoAgentOptions.skills`; it does not enumerate skill sources, add an implicit
workspace source, cache release metadata, or resolve Cloud storage. Hosted images own catalog
listing, exact-name resolution, and any materialization required by `filesLocation: 'workspace'`.

Local images keep filesystem and plugin discovery in `@dexto/agent-management` and expose it as
`LocalSkills`. The local implementation re-reads skill files for each operation, so local creator
tools and ordinary edits are visible without a Core refresh API. The local harness discovers
standalone skills from the canonical `<workspace>/.agents/skills/` and `~/.agents/skills/` roots,
retains the legacy `<workspace>/skills/`, `<workspace>/.dexto/skills/`, and `~/.dexto/skills/`
roots for compatibility, and also discovers Claude-compatible plugin skills. New skills should use
the canonical roots. Those filesystem details remain host behavior; they are not part of the Core
contract or a promise made by hosted images.

Skills remain separate from prompt-only slash commands. Enable the `skill_load` builtin when an
agent should load skills, and use `/skills` or `GET /api/skills` to inspect the host catalog.
