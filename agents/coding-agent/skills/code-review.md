---
title: Code Review
description: Perform a thorough code review on the specified files or changes
arguments:
  - name: focus
    description: Optional focus area (security, performance, style, all)
    required: false
---

# Code Review Skill

You are now performing a code review. Follow these guidelines:

## Review Checklist

1. **Correctness**: Does the code do what it's supposed to do?
2. **Security**: Are there any security vulnerabilities (injection, XSS, etc.)?
3. **Performance**: Are there any obvious performance issues?
4. **Readability**: Is the code easy to understand?
5. **Maintainability**: Will this code be easy to maintain?
6. **Error Handling**: Are errors handled appropriately?
7. **Tests**: Are there adequate tests for the changes?

## Output Format

Structure your review as:

### Summary
Brief overview of what the code does and overall assessment.

### Issues Found
List any problems, categorized by severity:
- **Critical**: Must fix before merge
- **Major**: Should fix, but not blocking
- **Minor**: Nice to have improvements
- **Nitpick**: Style/preference suggestions

### Positive Highlights
Note any particularly good patterns or practices.

### Recommendations
Actionable suggestions for improvement.

---

Begin the code review now. If no specific files were mentioned, ask the user what they'd like reviewed.
