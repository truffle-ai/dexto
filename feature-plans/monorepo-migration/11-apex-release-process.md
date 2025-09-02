# Reference: “Apex” Monorepo Release Process (Changesets + CI)

This document captures a more elaborate monorepo release workflow used by another project (referred to here as “apex”) so we can revisit later if we want stronger prerelease and snapshot releases. Our current plan intentionally keeps things simpler (see 07-release-policy.md).

## Overview
- Uses Changesets for versioning and changelogs.
- Splits responsibilities across multiple CI workflows:
  - Opens/updates a “Version Packages” PR on pushes to `main`.
  - Publishes prereleases (alpha/beta) behind branch naming or manual dispatch.
  - Publishes per‑PR “snapshot” builds under a unique dist‑tag.
  - Generates rich changelogs via a dedicated workflow (optionally posts to Slack).
  - Syncs dependency update changesets from Renovate.

## Components & Workflows

### 1) Version PR (on main)
- Trigger: push to `main`.
- Action: `changesets/action@v1` creates/updates a “chore: version packages” PR.
- Setup details:
  - Uses a GitHub App token for write permissions (via `actions/create-github-app-token`).
  - Checks out with `fetch-depth: 0` so Changesets can compute accurate changelogs.
  - May bump a specific package prerelease version before running changesets.

### 2) Prerelease Publish (alpha/beta)
- Trigger: either manual (`workflow_dispatch`) or a naming convention (e.g., when branch contains `changeset-release`).
- Steps:
  - Install, build, authenticate to registry (NPM_TOKEN), then publish with a prerelease dist‑tag, e.g. `pnpm publish -r --tag alpha --access public`.
- Purpose: ship intermediates for early adopters without updating `latest`.

### 3) PR Snapshot Publishing
- Trigger: manual (workflow_dispatch) per PR/branch.
- Steps:
  - Enter/exit Changesets pre mode as needed.
  - Run `changeset version --snapshot <tag>` where `<tag>` is a slugified branch name or supplied input.
  - Publish with `--tag <tag>` so consumers can install the PR snapshot.
- Purpose: allow real‑world validation of a PR before merging.

### 4) Changelog Generation (post-release)
- Trigger: manual or when on a designated release branch.
- Steps:
  - Build selected packages and run a tool that aggregates release notes/changelogs.
  - Optionally post to Slack or external channels.
- Purpose: richer release notes beyond the default Changesets output.

### 5) Renovate × Changesets Sync
- Trigger: push to a specific path or on schedule.
- Steps:
  - Generates/updates changesets for Renovate dependency PRs so they can be batched and versioned consistently.

## Pros & Cons

### Pros
- Robust prerelease strategy (alpha/beta) without touching `latest`.
- Per‑PR snapshot publishing allows quick consumer testing.
- Richer changelog generation and integrations (e.g., Slack).
- Fine‑grained control via branch naming and manual workflows.

### Cons
- Higher complexity and maintenance overhead.
- Requires GitHub App tokens and careful secrets management.
- Multiple workflows to keep in sync; more moving parts.

## Our Current Approach (Short Summary)
- Simple, stable pipeline:
  - “Version Packages” PR on push to `main`.
  - Publish on merge or manual dispatch.
  - PR guard requiring changesets (with override label), and automation to add a default changeset in PRs from local branches.
- Pros: low friction, easy to maintain, works well at our current scale.
- Cons: no prerelease/snapshot tags yet; changelog remains Changesets‑generated.

## Migration Path (If We Want “Apex” Features Later)
- Add a gated prerelease workflow:
  - Publish with `--tag alpha` (or `next`/`beta`) either on `workflow_dispatch` or on branches matching `changeset-release/*`.
- Add PR snapshot workflow:
  - Use `changeset version --snapshot <tag>` and publish to `--tag <tag>`.
- Add changelog workflow:
  - Post‑release aggregation and optional Slack messages.
- Requirements:
  - `NPM_TOKEN` for publish steps.
  - (Optional) GitHub App credentials if you want to write scoped changes in the repo or open PRs with an app identity.

## Notes on CLI Style (turbo vs pnpm turbo)
- In package.json scripts, `turbo run …` is fine (scripts resolve local binaries from `node_modules/.bin`).
- In CI steps outside scripts, `pnpm turbo` is often preferred to ensure consistent workspace execution context.

## Decision Record (Now)
- We keep our simpler model (see 07-release-policy.md): open Version PR → publish on merge; enforce changesets via guard and auto‑changeset.
- We will revisit the “apex” prerelease/snapshot model if our release needs grow.

