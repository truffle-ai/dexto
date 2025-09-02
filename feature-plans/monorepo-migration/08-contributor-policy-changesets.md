# Contributor Policy: Changesets

Do contributors need a changeset? Usually yes — but only when their PR affects published packages.

## When a Changeset is Required
- PR changes code that ships in a published package (initially: `@dexto/core`, `dexto`, optionally `@dexto/server`).
- Types/exports that users import, runtime behavior, CLI flags/commands, output format changes.

## When It’s Not Required
- Docs-only changes, CI/config-only changes, tests-only changes.
- Changes in private packages (e.g., `@dexto/webui` if private) or example apps.

## How to Add One
1) Run `pnpm changeset` locally.
2) Select affected packages.
3) Choose bump: Patch / Minor / Major.
4) Write a concise description (used in changelogs). Commit the created file under `.changeset/`.

If unsure, choose Patch — reviewers/maintainers can adjust before release.

## Reviewer/Maintainer Guidance
- Validate bump type vs. impact; suggest corrections in review.
- Edit the changeset file in the PR (or push a follow-up commit) to fix package selection or bump level.
- If missing but needed, request the contributor add it, or add it yourself before merging.

## CI Guard (Recommended)
Add a check that fails the PR if publishable packages change without a changeset. Allow an override label (e.g., `release: none`) for maintainers when appropriate.

## PR Template Snippet
```
### Release Note
- [ ] No release needed (docs/chore/test-only/private package)
- [ ] Changeset added via `pnpm changeset` (select packages + bump)
  - Bump type: Patch / Minor / Major
  - Packages: ...

If unsure on bump, default to Patch — reviewer will adjust.
```

## Why This Policy
- Keeps release notes and versions meaningful while staying contributor-friendly.
- Lockstep reduces risk — if someone undershoots a bump, maintainers can adjust before the “Version Packages” PR merges.

