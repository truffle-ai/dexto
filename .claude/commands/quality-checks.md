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

## Execution Order

The checks run in this order and stop on first failure:

### 1. Build Check
```bash
pnpm run build > /dev/null 2>&1 || pnpm run build
```
- Suppresses verbose output on success to save context
- Shows full output only if build fails
- **If dev server is running**: Reminds you to restart it after build completes

### 2. Test Suite
```bash
pnpm test > /dev/null 2>&1 || pnpm test
```
- Runs all tests (unit + integration)
- Suppresses verbose output on success
- Shows full output only if tests fail

### 3. Lint Check
```bash
pnpm run lint
```
- Always shows output (to see warnings)
- Checks code style and best practices
- May auto-fix some issues

### 4. Type Check
```bash
pnpm run typecheck > /dev/null 2>&1 || pnpm run typecheck
```
- Validates TypeScript types across the project
- Suppresses verbose output on success
- Shows full output only if type errors found

## Output Format

Provides a clear summary:

```
✅ Build: PASSED
✅ Tests: PASSED (142 tests)
⚠️  Lint: PASSED (3 warnings)
✅ Typecheck: PASSED

All quality checks passed! ✨
```

Or on failure:

```
✅ Build: PASSED
❌ Tests: FAILED
   - 2 tests failed
   - See output above for details

Quality checks failed. Please fix the issues before proceeding.
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
