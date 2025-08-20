---
description: "Extract CodeRabbit AI review comments from Dexto PRs with powerful filtering options"
allowed-tools: ["bash", "read"]
---

# CodeRabbit Comment Extractor

Extract and filter CodeRabbit AI review comments from Dexto GitHub pull requests.

!./scripts/extract-coderabbit.sh truffle-ai/dexto $ARGUMENTS

## Usage Examples

```bash
# Get all CodeRabbit comments from PR #123
/coderabbit 123

# Get latest actionable review (substantial feedback)
/coderabbit 123 --latest-actionable

# Get all unresolved comments across all reviews  
/coderabbit 123 --unresolved-only

# Get unresolved comments from latest actionable review (most useful)
/coderabbit 123 --latest-actionable --unresolved-only

# Get unresolved comments from latest review by timestamp
/coderabbit 123 --latest-only --unresolved-only

# Show help
/coderabbit 123 --help
```

## Available Flags (combinable)

- `--latest-only`: Latest review by timestamp (most recent)
- `--latest-actionable`: Latest review with substantial feedback (contains "Actionable comments posted:")  
- `--unresolved-only`: Only comments that haven't been resolved

## Common Workflows

**Focus on current work:**
```bash
/coderabbit 456 --latest-actionable --unresolved-only
```

**Quick review check:**
```bash  
/coderabbit 456 --unresolved-only
```

**See latest feedback:**
```bash
/coderabbit 456 --latest-actionable  
```

## Requirements

- GitHub CLI (`gh`) must be installed and authenticated
- Access to the target repository
- PR must have CodeRabbit review comments