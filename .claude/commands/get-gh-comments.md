---
description: "Extract GitHub review comments from Dexto PRs with powerful filtering options"
allowed-tools: ["bash", "read"]
---

# GitHub Review Comment Extractor

Extract and filter GitHub review comments from Dexto pull requests with support for any reviewer.

!./scripts/extract-review-comments.sh truffle-ai/dexto $ARGUMENTS

## Usage Examples

```bash
# Get all review comments from PR #123
/get-gh-comments 123

# Get CodeRabbit comments only
/get-gh-comments 123 --reviewer coderabbitai[bot]

# Get human reviewer comments  
/get-gh-comments 123 --reviewer rahulkarajgikar

# Get latest actionable review from CodeRabbit (substantial feedback)
/get-gh-comments 123 --reviewer coderabbitai[bot] --latest-actionable

# Get all unresolved comments from any reviewer
/get-gh-comments 123 --unresolved-only

# Get unresolved comments from latest actionable CodeRabbit review (most useful for CodeRabbit)
/get-gh-comments 123 --reviewer coderabbitai[bot] --latest-actionable --unresolved-only

# Get unresolved comments from latest human review
/get-gh-comments 123 --reviewer rahulkarajgikar --latest-actionable --unresolved-only

# Show help
/get-gh-comments 123 --help
```

## Available Options

### Reviewer Filter
- `--reviewer LOGIN_ID`: Filter by specific reviewer (e.g., `coderabbitai[bot]`, `rahulkarajgikar`)

### Flags (combinable)
- `--latest-only`: Latest review by timestamp (most recent)
- `--latest-actionable`: Latest review with substantial feedback (has top-level summary)  
- `--unresolved-only`: Only comments that haven't been resolved

## Common Workflows

**Focus on CodeRabbit's current feedback:**
```bash
/get-gh-comments 456 --reviewer coderabbitai[bot] --latest-actionable --unresolved-only
```

**Check all unresolved issues:**
```bash  
/get-gh-comments 456 --unresolved-only
```

**Review human feedback:**
```bash
/get-gh-comments 456 --reviewer username --latest-actionable  
```

**See all feedback from a specific reviewer:**
```bash
/get-gh-comments 456 --reviewer coderabbitai[bot]
```

## Requirements

- GitHub CLI (`gh`) must be installed and authenticated
- Access to the target repository
- PR must have review comments

## Notes

- **Actionable Reviews**: Reviews with top-level summaries (body content), typically containing substantial feedback
- **Resolution Status**: Uses GitHub's review thread resolution system
- **Reviewer IDs**: Use GitHub login names (bot accounts include `[bot]` suffix)