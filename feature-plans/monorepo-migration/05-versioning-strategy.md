# Versioning Strategy

We will start with lockstep versioning for primary packages, then provide a path to independent or hybrid versioning.

## Start: Lockstep Versioning
- Changesets `fixed` group example:
  - `fixed: [["@dexto/core", "dexto", "@dexto/server"]]`
- Highest bump wins across the group; simplifies compatibility and releases.
- Pros: simple, avoids skew. Cons: bumps unaffected packages.

## Independent Versioning (Future)
- Remove `fixed`; version per-package based on changesets.
- Pros: targeted releases; Cons: more coordination, risk of skew.

## Hybrid Versioning
- Keep fixed sub-groups for tightly coupled packages (e.g., core+server); others independent.
- Balanced noise vs. coherence; more complex config.

## Recommended Path
- Start lockstep for `@dexto/core`, `dexto` (and `@dexto/server` if split).
- Keep `@dexto/webui` private/unpublished initially (or independent if published).
- Revisit after a few releases to switch to hybrid/independent if needed.

