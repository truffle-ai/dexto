---
description: "Extract GitHub review comments from Dexto PRs with powerful filtering options"
allowed-tools: ["bash", "read"]
---

# GitHub Review Comment Extractor

Extract and filter GitHub review comments from Dexto pull requests with support for any reviewer.

I'll parse your request and call the appropriate script with the right parameters. You can use natural language like:
- "for PR 293 from rahulkarajgikar" 
- "get unresolved comments from latest CodeRabbit review on PR 456"
- "show all comments from PR 123"

The script I'll use: `./scripts/extract-review-comments.sh truffle-ai/dexto [PR_NUMBER] [OPTIONS]`

## Natural Language Examples

```bash
# Use natural language - Claude will parse these intelligently!
/get-gh-comments for PR 293 from rahulkarajgikar
/get-gh-comments unresolved comments from latest CodeRabbit review on PR 456  
/get-gh-comments show all comments from PR 123
/get-gh-comments latest actionable review from PR 789
/get-gh-comments get PR 555 comments from coderabbitai that are unresolved
```

## Traditional Flag Examples

```bash
# Get all review comments from PR #123
/get-gh-comments 123

# Get CodeRabbit comments only - uses quotes to avoid parsing issues in shell
/get-gh-comments 123 --reviewer "coderabbitai[bot]"

# Get human reviewer comments  
/get-gh-comments 123 --reviewer rahulkarajgikar

# Get latest actionable review from CodeRabbit (substantial feedback) - quotes to avoid issues in shell
/get-gh-comments 123 --reviewer "coderabbitai[bot]" --latest-actionable

# Get all unresolved comments from any reviewer
/get-gh-comments 123 --unresolved-only

# Get unresolved comments from latest actionable review (most useful for CodeRabbit)
/get-gh-comments 123 --reviewer "coderabbitai[bot]" --latest-actionable --unresolved-only

# Get unresolved comments from latest actionable human review
/get-gh-comments 123 --reviewer rahulkarajgikar --latest-actionable --unresolved-only

# Show help
/get-gh-comments 123 --help
```

## Defaults

If user doesn't specify, prefer unresolved only. No point in looking at resolved comments generally
If user doesn't specify to use the latest only, run script with both --latest-actionable and without, and consolidate the two to give a meaningful response

## Available Options

### Reviewer Filter
- `--reviewer LOGIN_ID`: Filter by specific reviewer (e.g., `coderabbitai[bot]`, `rahulkarajgikar`, `shaunak99`)

### Flags (combinable)
- `--latest-only`: Latest review by timestamp (most recent)
- `--latest-actionable`: Latest review with substantial feedback (has top-level summary)  
- `--unresolved-only`: Only comments that haven't been resolved

## Common Workflows

**Focus on CodeRabbit's current feedback:**
```bash
/get-gh-comments 456 --reviewer "coderabbitai[bot]" --latest-actionable --unresolved-only
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
/get-gh-comments 456 --reviewer "coderabbitai[bot]"
```

## Requirements

- GitHub CLI (`gh`) must be installed and authenticated
- Access to the target repository
- PR must have review comments

## Notes

- **Actionable Reviews**: Reviews with top-level summaries (body content), typically containing substantial feedback
- **Resolution Status**: Uses GitHub's review thread resolution system
- **Reviewer IDs**: Use GitHub login names (bot accounts include `[bot]` suffix)


## Responding back to user

While responding back to the user, mention the following information:
- Number of total comments (would be at the bottom of the script response)

Then for each comment, mention:
- The number of the comment
- The line number of the comment
- High level information about what the comment is
- Potential fix: keep this short about what needs to be done to fix it

This keeps the response concise for the user while also informing them of the essentials
