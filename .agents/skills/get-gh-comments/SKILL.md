---
name: get-gh-comments
description: "Extract and triage GitHub pull request review comments with the repo's `scripts/extract-review-comments.sh` helper. Use when the user asks to inspect PR feedback, pull unresolved comments, filter by reviewer such as CodeRabbit or a human reviewer, page through large reviews, or decide whether review suggestions should lead to code changes."
---

# GitHub Review Comments

## Overview

Use `scripts/extract-review-comments.sh` to pull inline PR review comments, then judge the feedback against the current code before making changes.
Prefer unresolved comments and small pages so large reviews do not get truncated.

## Workflow

1. Parse the request into PR number, reviewer filter, latest-review mode, unresolved filter, and pagination.
2. Default to `--unresolved-only` when the user does not explicitly ask for resolved comments.
3. If the user does not explicitly ask for only the latest review, run both:
    - `--latest-actionable`
    - the broader unresolved query without latest filtering
      Consolidate the two views into one response.
4. Use `--limit` whenever the PR may have many comments.
    - Start with `--limit 10`.
    - Prefer `--limit 5` for `coderabbitai[bot]`.
5. Read the cited code before acting. Review comments can be stale or based on an outdated diff.

## Command Patterns

- All comments:
  `./scripts/extract-review-comments.sh truffle-ai/dexto-cloud PR_NUMBER`
- Unresolved comments:
  `./scripts/extract-review-comments.sh truffle-ai/dexto-cloud PR_NUMBER --unresolved-only --limit 10`
- Specific reviewer:
  `./scripts/extract-review-comments.sh truffle-ai/dexto-cloud PR_NUMBER --reviewer "coderabbitai[bot]" --unresolved-only --limit 5`
- Latest actionable review:
  `./scripts/extract-review-comments.sh truffle-ai/dexto-cloud PR_NUMBER --reviewer REVIEWER --latest-actionable --limit 10`
- Pagination:
  add `--offset N`

## Review Bodies

The script only extracts inline comments.
If the user asks for top-level review text or "outside diff range" feedback, fetch the latest matching review body separately:

```bash
gh api repos/truffle-ai/dexto-cloud/pulls/PR_NUMBER/reviews --jq '[.[] | select(.user.login == "coderabbitai[bot]" and .body != null and .body != "")] | sort_by(.submitted_at) | last | .body'
```

## Response Expectations

When presenting comments, include:

- total comments found
- file path and line number
- GitHub link
- short issue summary
- suggested fix
- your assessment of whether the fix is actually needed

## Replying To A Thread

If the user asks to reply on GitHub, use:

```bash
gh api repos/truffle-ai/dexto-cloud/pulls/PR_NUMBER/comments/COMMENT_ID/replies \
  -X POST \
  --field body="Your reply here"
```

## Requirements

- `gh` installed and authenticated
- `jq` installed
