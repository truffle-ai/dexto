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
pnpm run build >/dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "❌ Build failed. Reading turbo logs..."
  find packages -name "turbo-build.log" -type f -exec sh -c 'echo ""; echo "=== $(dirname {}) ==="; tail -50 {}' \;
  exit 1
fi
echo "✅ Build passed"
```
- Suppresses verbose output on success (saves LLM context)
- On failure, reads turbo's per-package logs automatically
- Shows last 50 lines from each package's build log
- **Single build run** - turbo already writes logs to `.turbo/turbo-build.log`
- **If dev server is running**: Reminds you to restart it after build completes

### 2. Test Suite
```bash
pnpm test >/dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "❌ Tests failed. Running tests with output..."
  pnpm test
  exit 1
fi
echo "✅ Tests passed"
```
- Runs all tests (unit + integration)
- Suppresses verbose output on success (saves LLM context)
- On failure, re-runs tests with full output
- **Single test run on success** - only double-runs on failure for diagnostics

### 3. Lint Check
```bash
pnpm run lint
```
- Always shows output (to see warnings)
- Checks code style and best practices
- May auto-fix some issues

### 4. Type Check
```bash
pnpm run typecheck >/dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "❌ Typecheck failed. Reading turbo logs..."
  find packages -name "turbo-typecheck.log" -type f -exec sh -c 'echo ""; echo "=== $(dirname {}) ==="; tail -100 {}' \;
  exit 1
fi
echo "✅ Typecheck passed"
```
- Validates TypeScript types across the project
- Suppresses verbose output on success (saves LLM context)
- On failure, reads turbo's per-package typecheck logs
- Shows last 100 lines from each package's typecheck log
- **Single typecheck run** - turbo already writes logs to `.turbo/turbo-typecheck.log`

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
