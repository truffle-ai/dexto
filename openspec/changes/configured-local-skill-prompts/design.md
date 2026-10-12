## Context

LocalSkills already owns filesystem discovery and fresh instruction reads. File prompts remain a separate prompt/menu surface, but bundled local agents advertise their instructions as model-loadable skills.

## Goals / Non-Goals

Restore the configured local instruction capability without a second discovery engine, a Core factory change, or a directory grant derived from a prompt filename. Hosted/custom Skills retain their ownership and behavior.

## Decisions

Local hosts call registerConfiguredSkillPrompts after service resolution. The helper registers files only on LocalSkills. Its registration replaces the configured set for that service and clones caller entries. Both CLI construction paths and shared agent creation use the same boundary.

Configured identities use the valid frontmatter id, falling back to the filename, and the configured namespace. Skill name/title metadata does not rename a file prompt. Standalone/plugin skills retain precedence; conflicting unshadowed configured identities fail explicitly. Missing, invalid-name, standalone SKILL.md and outside-parent symlink targets are skipped. Instructions are read afresh; disable-model-invocation true in file frontmatter excludes the capability.

Configured files load as instruction-only hosted results with no supporting files and null baseDirectory. readFile refuses sibling access. Ordinary bundles keep their existing directory behavior.

## Risks / Trade-offs

Configured fallback resolution checks usable discovered roots to keep list/load precedence consistent. No new cache is introduced. Current strict file-prompt configuration does not accept a disable-model-invocation YAML property; this change does not extend that schema.

## Validation

Real installed-agent CLI JSON/JSONL smoke, host metadata/privacy/precedence/symlink tests, shared agent-creation consumer tests, existing skill tests, and the repository quality gate.
