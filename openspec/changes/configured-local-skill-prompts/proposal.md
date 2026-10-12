## Why

Bundled local agents still configure instruction files as file prompts, but the local Skills catalog only discovers standalone and plugin bundles. The advertised `skill_load` call cannot load the installed coding agent's code-review instructions.

## What Changes

- Register validated configured file prompts with the existing local Skills engine when a local host constructs an agent.
- Preserve discovered-skill precedence, prompt id/namespace semantics, and private frontmatter exclusion.
- Grant instructions only: no supporting files or access to sibling files.
- Exercise the installed coding agent through the deterministic packaged-runtime smoke.

## Capabilities

### New Capabilities

- `local-skills`: Opt-in configured prompt-file skill registration in local hosts.

### Modified Capabilities

None.

## Impact

Agent-management local Skills and agent creation, CLI service assembly, packaged-runtime tests and documentation. Core contracts and custom image Skills remain unchanged.
