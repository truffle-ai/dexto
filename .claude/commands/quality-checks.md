---
description: "Run all quality checks (build, test, lint, typecheck) before completing tasks"
allowed-tools: ["bash"]
---

# Quality Checks

Runs all pre-commit validation checks to ensure code quality before task completion.

## What Gets Checked

1. **Build** - Verify compilation succeeds
2. **Tests** - Ensure all tests pass (unit + integration)
3. **Lint** - Check code style and conventions
4. **Typecheck** - Validate TypeScript types

## Usage

```bash
/quality-checks
```

## Implementation

Use the `scripts/quality-checks.sh` script to run individual checks or all checks.

### Script Usage

```bash
# Run individual checks (default: show last 200 lines on failure)
bash scripts/quality-checks.sh build
bash scripts/quality-checks.sh test
bash scripts/quality-checks.sh lint
bash scripts/quality-checks.sh typecheck

# Control output on failure (optional second argument)
bash scripts/quality-checks.sh build 100      # Show last 100 lines
bash scripts/quality-checks.sh test 50        # Show last 50 lines
bash scripts/quality-checks.sh typecheck all  # Show all output

# Run all checks in order
bash scripts/quality-checks.sh all            # Show last 200 lines on failure
bash scripts/quality-checks.sh all 100        # Show last 100 lines on failure
bash scripts/quality-checks.sh all all        # Show all output on failure
```

## Instructions for LLM

**Run checks in this order and stop on first failure:**

1. Build check: `bash scripts/quality-checks.sh build`
2. Test check: `bash scripts/quality-checks.sh test`
3. Lint check: `bash scripts/quality-checks.sh lint`
4. Typecheck: `bash scripts/quality-checks.sh typecheck`

**Default behavior:**
- Shows last 200 lines on failure (usually sufficient)
- No output on success (saves LLM context)
- You can request more lines if needed: `bash scripts/quality-checks.sh build 500`
- You can request all output if needed: `bash scripts/quality-checks.sh build all`

**Flexibility:**
- Run individual checks as needed (e.g., just build after code changes)
- Re-run specific failing checks
- Adjust output lines based on error complexity
- Use `bash scripts/quality-checks.sh all` for convenience to run all checks

**Output Strategy:**
- Each command runs **once only** (no double-runs)
- Output captured to `/tmp/build/dexto-{check}-$$.log`
- **Success**: No output shown, temp file deleted (minimal context)
- **Failure**: Last N lines displayed (default 200), temp file deleted, execution stops

This minimizes unnecessary context while providing sufficient diagnostics on failures.

## Output Format

**On success** (minimal output):
```
Running quality checks...

✅ Build passed
✅ Tests passed
✅ Lint passed
✅ Typecheck passed

All quality checks passed! ✨
```

**On failure** (full diagnostic output):
```
Running quality checks...

✅ Build passed
❌ Tests failed:

[Full test output displayed here]
```

## When to Run

- **Before completing any task** - Mandatory
- **Before creating commits** - Ensures clean history
- **After major refactoring** - Verify nothing broke
- **Before requesting PR review** - Save reviewer time

## Notes

- All checks must pass before marking tasks as complete
- The command exits on first failure for fast feedback
- Lint warnings don't block completion, but should be addressed
- Tests include both unit and integration tests
