# Release Policy & Best Practices

We will use Changesets with a batched release cadence. Versions only change when the aggregated "Version Packages" PR is merged (or when running version/publish), not on every PR.

## Workflow Overview
1) Regular PRs
- For user-facing changes to published packages (`@dexto/core`, `dexto`, optionally `@dexto/server`), authors run `pnpm changeset` and choose patch/minor/major.
- Docs/chore/test-only or private-only changes don’t require a changeset.

2) Release PR (automated)
- GitHub Action opens/updates a "Version Packages" PR aggregating pending changesets with generated changelogs.

3) Versioning & Publishing
- On merge of Version PR, CI runs:
  - `pnpm changeset version`
  - `pnpm -w build`
  - `pnpm -r publish --access public` (requires `NPM_TOKEN`)
- Maintainers can run the same locally if needed.

## Example GitHub Actions
Two-workflow setup (names illustrative): opener and publisher.

### Opener (creates/updates Version PR)
See monorepo-migration.md (original draft) or wire with `changesets/action@v1`.

### Publisher (versions + publishes on merge)
Run `pnpm changeset version`, rebuild, and publish with `NODE_AUTH_TOKEN`.

## Lockstep Group Behavior
- Fixed group for `@dexto/core`, `dexto`, optionally `@dexto/server`.
- Highest bump wins across the group; packages outside the group are unaffected unless explicitly included.

## When to Add a Changeset
- Patch: bug fix, perf improvement, safe internal changes.
- Minor: backward-compatible features or config.
- Major: breaking changes.
- Skip: docs-only outside packages, CI/config-only, private-only, tests-only.

## Best Practices
- Batch releases (weekly or milestone-based) by merging the Version PR.
- Dry-run on significant changes: `pnpm -w build && pnpm -r publish --dry-run`.
- Keep `bumpVersionsWithWorkspaceProtocolOnly: true` and an `ignore` list for non-published paths.
- Prefer clear, imperative changeset descriptions.
- Use pre-releases + dist-tags for canaries/betas; keep `latest` stable.

## Rollback & Hotfixes
- Patch quickly with a new changeset; optionally `npm deprecate` bad versions.
- Keep releases small to reduce blast radius.

## Maintainer Story: Batch Release After Many PRs
Scenario: 10 PRs merged; publish later as one version bump.

1) During PRs
- Contributors add changesets where needed; `pnpm changeset status` shows pending.

2) Ready to release
- Review Version PR changelog/bump sizes; adjust as needed (lockstep: highest wins).

3) Trigger
- Merge Version PR (CI versions + publishes) or run locally:
  - `pnpm changeset version`
  - `pnpm -w install --frozen-lockfile`
  - `pnpm -w build`
  - `pnpm -r publish --access public`

4) Verify
- Check npm publish, dist-tags, CI. Optionally create a GitHub Release.

5) Post-release
- Communicate changes; update docs/examples as needed; flip pre-release tags to latest when stable.

Edge cases: add a missing changeset in a follow-up PR; correct bump sizes before merging the Version PR, or adjust in a subsequent release.

