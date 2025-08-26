# Versioning Dexto

This document describes the standard procedure for publishing a new version of `dexto` [CLI + library]

## 1. Go to main branch of your fork and ensure that the code is up-to-date

```bash
git checkout main
git fetch upstream
git rebase upstream/main
git push
```

This will sync your local fork's main branch with the remote repository main branch

## 2. Bump version locally

Now that you are on main branch of your fork and have synced your repo with the remote branch, 
use one of the following commands to update the version in `package.json`, create a corresponding git commit, and tag:

```bash
# For a PATCH release (e.g., 1.2.3 → 1.2.4)
npm version patch

# For a MINOR release (e.g., 1.2.3 → 1.3.0)
npm version minor

# For a MAJOR release (e.g., 1.2.3 → 2.0.0)
npm version major
```

Each command will:

- Update the `version` field in `package.json`.
- Create a new git commit.
- Create a new git tag prefixed with `v` (e.g., `v1.2.4`).

## 3. Push to remote repository

Push the commit and associated tags to the remote repository. Replace `upstream` and `main` with your remote/branch if different [you can check with `git remote -v`]:

```bash
git fetch upstream
# (optional) Rebase or merge to ensure you're up to date:
git rebase upstream/main

# Push commit and tags:
git push upstream main --follow-tags
```

## 4. Automatic publish via GitHub Actions

See [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) for the publish workflow configuration.

After this workflow completes successfully, the new version of `dexto` will be available on npm. 