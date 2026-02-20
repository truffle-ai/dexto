---
description: 'Analyze a file or folder for code slop and quality issues compared to main branch'
allowed-tools: ['bash', 'grep', 'glob', 'read']
---

# Deslop

Analyzes a file or folder for code quality issues and slop by comparing against the main branch.

## Usage

```bash
/deslop <path>
```

Where `<path>` is a file or folder relative to the repo root, e.g.:

- `/deslop packages/cli/src/cli/ink-cli/components/overlays/ModelSelectorRefactored.tsx`
- `/deslop packages/core/src/approval`

## What It Checks

### 1. Functional Changes

- Run `git diff main -- <path>` to see all changes
- Identify what the diff does (new features, refactors, bug fixes)

### 2. Code Slop Patterns

Look for:

- **Duplicated logic** - Same code block repeated 3+ times (extract to helper)
- **Unnecessary type guards** - `isX` functions that just negate another guard
- **Dead code** - Unused imports, variables, or functions
- **Magic numbers** - Hardcoded numbers without constants
- **Complex conditionals** - Deeply nested if/else that could be simplified
- **Large if-else trees** - Use early returns, switch with guards, or extract to helper functions
- **Missing early returns** - Arrow code that could be early-returned
- **Inconsistent naming** - Mixed snake_case/camelCase in same file
- **Bad naming** - Vague names like `data`, `temp`, `stuff`, `foo`, `bar`, `result`, `val`, `item`, `obj`
    - Good names describe intent: `validatedUserId`, `currentLogLevel`, `pendingApprovalRequests`
- **One-line wrapper functions** - Functions that just call another function without adding logic (e.g., `const foo = (x) => bar(x)`). Either inline or merge the logic.
- **Unused refs/state** - Refs kept in sync with state that could be simplified

### 3. Type Safety Issues

**Type casting (`as X`) is a sign of slop** unless absolutely necessary. Always prefer:

- Proper type narrowing with `typeof`/`instanceof` checks
- Discriminated unions
- Type guards (`isX` functions that return type predicates)
- Using `z.output<typeof Schema>` for derived types

Common patterns to fix:

- `as Record<string, unknown>` → Use proper typing or extract to helper
- `as unknown as X` → Double cast usually indicates type mismatch - fix the source type
- `as const` → Usually fine for literal types
- Type casts after type checks → Remove casts, TypeScript narrows automatically

Avoid:

- `any` types that should be more specific
- Missing type annotations on function parameters
- Type assertions (`as X`) that could be avoided with proper narrowing
- Union types that could be discriminated

### 4. React/Component Patterns

- Unnecessary re-renders (missing useMemo/useCallback)
- Inline functions in JSX that recreate each render
- Missing dependency arrays
- Props passed unnecessarily deep

## Output Format

Provide a structured analysis:

```
## Changes from main

[Summary of what the diff does]

## Slop Found

### 1. [Issue Type]
**Location:** file:line
**Problem:** [Description]
**Fix:** [Suggested fix]

### 2. [Issue Type]
...
```

## Examples of Slop

### Duplicated Logic

```typescript
// BAD - same calculation repeated
if (x < 0) {
    offset = 0;
}
if (y < 0) {
    offset = 0;
}
if (z < 0) {
    offset = 0;
}

// GOOD - extract to helper
const computeOffset = (val) => (val < 0 ? 0 : val);
```

### Pointless Type Guard

```typescript
// BAD - just negates another guard
function isModelOption(item: SelectorItem): item is ModelOption {
    return !isAddCustomOption(item);
}

// GOOD - just use index > 0 directly, or type assertion
const models = items.slice(1) as ModelOption[];
```

### Ref/State Redundancy

```typescript
// BAD - maintaining sync between ref and state
const [index, setIndex] = useState(0);
const indexRef = useRef(0);
useEffect(() => {
    indexRef.current = index;
}, [index]);

// GOOD - use ref directly if only used in handlers, or state if only for rendering
```
