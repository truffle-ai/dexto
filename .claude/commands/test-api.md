---
description: "Analyze API endpoints, identify test gaps, update test script, and run API tests"
allowed-tools: ["bash", "read", "write", "edit", "glob", "grep"]
---

# API Test Coverage Analyzer & Runner

Analyzes the API server endpoints, compares against existing test coverage, identifies gaps, updates the test script, and runs the tests.

## What It Does

1. **Analyzes API Server Code**
   - Reads API server implementation to discover all registered endpoints
   - Identifies HTTP methods, route paths, and validation schemas
   - Extracts expected response codes and error conditions

2. **Analyzes Existing Test Coverage**
   - Reads `scripts/test_api.sh`
   - Maps existing tests to endpoints
   - Identifies untested endpoints

3. **Identifies Test Gaps**
   - Compares registered routes with test coverage
   - Highlights missing tests for new features
   - Suggests test scenarios (CRUD operations, error cases, edge cases)

4. **Updates Test Script**
   - Adds missing tests to `scripts/test_api.sh`
   - Follows existing test patterns and conventions
   - Maintains proper structure and ordering

5. **Runs Tests**
   - Optionally starts dev server in background if not running
   - Executes the updated test script
   - Reports pass/fail results

## Usage

### Basic Usage (with running server)
```bash
/test-api
```

### With Dev Server Start
```bash
/test-api --start-server
```

### Analysis Only (no test execution)
```bash
/test-api --analyze-only
```

### Update Tests Only (no analysis report)
```bash
/test-api --update-only
```

## Workflow

When you run `/test-api`, I will:

### Step 1: Discover API Endpoints

Read the API server implementation:
- Main server file: `packages/cli/src/api/server.ts`
- Scan for route registration patterns:
  - `app.get(...)`, `app.post(...)`, `app.put(...)`, `app.delete(...)`
  - `app.use('/path', router)` - follow to handler files
  - `router.get(...)`, `router.post(...)`, etc.

For each discovered endpoint, extract:
- Route path (e.g., `/api/memory/:id`)
- HTTP method (GET, POST, PUT, DELETE)
- Request validation (look for schema parsing)
- Expected success codes
- Expected error codes

Follow imports to handler files:
- Memory routes: `packages/cli/src/api/memory/memory-handler.ts`
- A2A routes: `packages/cli/src/api/a2a.ts`
- MCP routes: `packages/cli/src/api/mcp/mcp_handler.ts`
- Any other handler modules referenced

### Step 2: Map Existing Test Coverage

Read `scripts/test_api.sh` and extract all `run_test` calls.

Parse test definitions to extract:
- Test name/description
- HTTP method
- Endpoint path
- Expected status code
- Request payload (if any)

Build a map of tested endpoints.

### Step 3: Generate Gap Report

Compare discovered endpoints (Step 1) with tested endpoints (Step 2).

For each untested endpoint, classify as:
- **Critical**: Recently modified files (use git to check)
- **High**: CRUD operations, core functionality
- **Medium**: Error validation, edge cases
- **Low**: Rarely-used features

Group gaps by API domain (infer from path prefix).

### Step 4: Generate Missing Tests

For each gap, generate test cases following the existing pattern from `test_api.sh`:

```bash
run_test "POST /api/resource create valid" POST "/api/resource" 200 '{"field":"value"}' || failures=$((failures+1))
run_test "POST /api/resource missing field" POST "/api/resource" 400 '{}' || failures=$((failures+1))
run_test "GET /api/resource/:id not found" GET "/api/resource/does-not-exist" 404 || failures=$((failures+1))
```

For each endpoint, generate:
- Happy path test (valid input, expected success)
- Validation error tests (missing fields, wrong types)
- Not found tests (for endpoints with IDs)
- Edge cases (empty values, special characters)

Insert new tests into appropriate sections in `test_api.sh`:
- Keep domain-related tests together
- Add cleanup tests at the end if needed
- Preserve existing test order and structure

### Step 5: Identify Integration Test Opportunities

Look for multi-step workflows that need testing:
- Features that interact with core system state changes
- Resource creation → usage → deletion flows
- State-dependent operations
- Cross-domain interactions

For recently modified files (use git to detect), add integration tests that verify:
- Features work correctly across different system states
- Data isolation and consistency
- Proper cleanup and state management

### Step 6: Run Tests

Check if server is running:
```bash
curl -sS http://localhost:3001/health > /dev/null 2>&1
```

If `--start-server` flag is present and server is not running:
```bash
pnpm dev > /tmp/dexto-dev-server.log 2>&1 &
echo $! > /tmp/dexto-dev-server.pid
sleep 10  # Wait for server startup
```

Execute tests:
```bash
bash scripts/test_api.sh
```

Report results with summary.

### Step 7: Cleanup

If server was started by this script:
```bash
kill $(cat /tmp/dexto-dev-server.pid) 2>/dev/null || true
rm -f /tmp/dexto-dev-server.pid /tmp/dexto-dev-server.log
```

## Test Pattern Guidelines

Follow these patterns when generating tests:

### Standard REST Endpoint Tests
```bash
# Create
run_test "POST /api/<example> create" POST "/api/<example>" 201 '{"name":"test"}' || failures=$((failures+1))
# List
run_test "GET /api/<example> list" GET "/api/<example>" 200 || failures=$((failures+1))
# Get by ID
run_test "GET /api/<example>/:id" GET "/api/<example>/test-id" 200 || failures=$((failures+1))
# Update
run_test "PUT /api/<example>/:id" PUT "/api/<example>/test-id" 200 '{"name":"updated"}' || failures=$((failures+1))
# Delete
run_test "DELETE /api/<example>/:id" DELETE "/api/<example>/test-id" 200 || failures=$((failures+1))
```

### Validation Error Tests
```bash
run_test "POST /api/<example> missing required field" POST "/api/<example>" 400 '{}' || failures=$((failures+1))
run_test "POST /api/<example> invalid type" POST "/api/<example>" 400 '{"name":123}' || failures=$((failures+1))
```

### Not Found Tests
```bash
run_test "GET /api/<example>/:id not found" GET "/api/<example>/nonexistent" 404 || failures=$((failures+1))
```

### Query Parameter Tests
```bash
run_test "GET /api/<example> with filter" GET "/api/<example>?status=active" 200 || failures=$((failures+1))
```

### Integration Tests
```bash
echo "$(yellow '[Integration]') Feature X workflow"
# Multi-step test logic here
# Create entity, perform operations, verify behavior
```

## Output Format

### Gap Analysis Report
```text
API Test Coverage Analysis
==========================

Discovered Endpoints: 45
Tested Endpoints: 38
Coverage: 84%

Untested Endpoints by Priority:
--------------------------------
CRITICAL (recently modified):
  ✗ POST /api/<endpoint-a>
  ✗ GET /api/<endpoint-a>
  ✗ PUT /api/<endpoint-a>/:id

HIGH (core CRUD operations):
  ✗ GET /api/<endpoint-b>
  ✗ DELETE /api/<endpoint-b>/:id

MEDIUM (validation/errors):
  ✗ POST /api/<endpoint-c> invalid cases

Generating 15 new test cases...
```

### Test Execution Report
```text
Running API tests against http://localhost:3001

[PASS] GET /health
[PASS] POST /api/<example> create valid
[PASS] GET /api/<example> list
...
[FAIL] PUT /api/<example>/:id update
  Expected: 200  Got: 500
  Body: {"error":"Internal server error"}

Summary: 47 passed, 1 failed
```

**Note**: `<example>` and `<endpoint-x>` are placeholders representing actual API endpoint names.

## Notes

- Always run this after adding new API endpoints
- Uses git to identify recently modified files for prioritization
- Tests follow existing patterns in `test_api.sh`
- JSON parsing uses jq if available, falls back to node
- Test data is cleaned up automatically
- Integration tests are stateful (run in sequence)

## Examples

```bash
# Check coverage and run tests (server already running)
/test-api

# Full workflow with server start
/test-api --start-server

# Just analyze gaps without updating
/test-api --analyze-only

# Update test script without running
/test-api --update-only
```
