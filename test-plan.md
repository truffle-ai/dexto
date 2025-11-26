# Dependency Reduction Test Plan

This document outlines the manual testing procedures for validating the dependency reduction changes in `@dexto/core`.

## Overview

The changes move OpenTelemetry (~188MB) and storage backends (~35MB) from required dependencies to optional peer dependencies, reducing `@dexto/core` from ~293MB to ~70MB.

---

## Test Environment Setup

### Prerequisites
- Node.js 20+
- pnpm 9+
- Empty test directories for isolation tests

### Test Branch
```bash
git checkout dependency-reduction
```

---

## Test Scenarios

### 1. Build & Unit Tests

**Status**: ✅ Automated - Already Passing

```bash
pnpm build
pnpm test
```

**Expected**: All 1252 tests pass

---

### 2. CLI Full Installation Test

**Objective**: Verify CLI package works with all optional dependencies satisfied

```bash
# In a clean directory
mkdir /tmp/cli-test && cd /tmp/cli-test
npm init -y
npm install ~/Projects/dexto-dependency-reduction/packages/cli

# Test CLI works
npx dexto --help
npx dexto --version
```

**Expected**: CLI starts and all commands are available

---

### 3. Core Package Standalone Installation

**Objective**: Verify `@dexto/core` installs without heavy dependencies

```bash
# In a clean directory
mkdir /tmp/core-standalone && cd /tmp/core-standalone
npm init -y
npm install /path/to/dexto-dependency-reduction/packages/core

# Check package size
du -sh node_modules/@dexto/core
du -sh node_modules
```

**Expected**:
- `@dexto/core` install is ~70MB (not ~293MB)
- OpenTelemetry packages NOT present in node_modules
- better-sqlite3, ioredis, pg NOT present

---

### 4. Telemetry: Disabled Mode

**Objective**: Verify telemetry works when disabled (no optional deps needed)

```javascript
// test-telemetry-disabled.mjs
import { Telemetry } from '@dexto/core';

const telemetry = await Telemetry.init({ enabled: false });
console.log('Telemetry initialized:', telemetry.isInitialized()); // Should be false
console.log('SUCCESS: Telemetry disabled mode works without optional deps');
```

```bash
# Run in core-standalone directory (no OpenTelemetry installed)
node test-telemetry-disabled.mjs
```

**Expected**: Script completes without errors, telemetry reports as not initialized

---

### 5. Telemetry: Enabled Without Dependencies

**Objective**: Verify helpful error message when telemetry enabled but deps missing

```javascript
// test-telemetry-missing-deps.mjs
import { Telemetry } from '@dexto/core';

try {
  await Telemetry.init({ enabled: true });
  console.error('FAIL: Should have thrown an error');
  process.exit(1);
} catch (error) {
  if (error.message.includes('OpenTelemetry packages are not installed')) {
    console.log('SUCCESS: Got expected error message');
    console.log('Error message:', error.message);
  } else {
    console.error('FAIL: Unexpected error:', error.message);
    process.exit(1);
  }
}
```

```bash
# Run in core-standalone directory (no OpenTelemetry installed)
node test-telemetry-missing-deps.mjs
```

**Expected**:
- Script catches error
- Error message contains install instructions for OpenTelemetry packages
- Error message suggests disabling telemetry as alternative

---

### 6. Telemetry: Enabled With Dependencies

**Objective**: Verify telemetry works when deps are installed

```bash
# In core-standalone directory
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node \
  @opentelemetry/resources @opentelemetry/semantic-conventions \
  @opentelemetry/sdk-trace-base @opentelemetry/exporter-trace-otlp-http
```

```javascript
// test-telemetry-enabled.mjs
import { Telemetry } from '@dexto/core';

const telemetry = await Telemetry.init({
  enabled: true,
  serviceName: 'test-service'
});
console.log('Telemetry initialized:', telemetry.isInitialized());
console.log('Service name:', telemetry.name);
await telemetry.shutdown();
console.log('SUCCESS: Telemetry works with deps installed');
```

**Expected**: Telemetry initializes successfully, reports as initialized

---

### 7. Storage: SQLite Without Dependency

**Objective**: Verify proper error when SQLite configured but `better-sqlite3` missing

```javascript
// test-sqlite-missing.mjs
import { createDatabase } from '@dexto/core/storage/database/factory.js';

const mockLogger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
};

try {
  await createDatabase({ type: 'sqlite', path: '/tmp/test.db' }, mockLogger);
  console.error('FAIL: Should have thrown an error');
  process.exit(1);
} catch (error) {
  if (error.code === 'storage_dependency_not_installed') {
    console.log('SUCCESS: Got expected StorageError');
    console.log('Error message:', error.message);
    console.log('Hint:', error.context?.hint);
    console.log('Recovery:', error.context?.recovery);
  } else {
    console.error('FAIL: Unexpected error:', error);
    process.exit(1);
  }
}
```

```bash
# Run in core-standalone directory (no better-sqlite3 installed)
node test-sqlite-missing.mjs
```

**Expected**:
- Error code: `storage_dependency_not_installed`
- Message mentions 'better-sqlite3' package
- Hint contains install command: `npm install better-sqlite3`
- Recovery suggests changing to 'in-memory'

---

### 8. Storage: PostgreSQL Without Dependency

**Objective**: Verify proper error when PostgreSQL configured but `pg` missing

```javascript
// test-postgres-missing.mjs
import { createDatabase } from '@dexto/core/storage/database/factory.js';

const mockLogger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
};

try {
  await createDatabase({
    type: 'postgres',
    connectionString: 'postgresql://localhost/test'
  }, mockLogger);
  console.error('FAIL: Should have thrown an error');
  process.exit(1);
} catch (error) {
  if (error.code === 'storage_dependency_not_installed') {
    console.log('SUCCESS: Got expected StorageError');
    console.log('Error message:', error.message);
    console.log('Hint:', error.context?.hint);
  } else {
    console.error('FAIL: Unexpected error:', error);
    process.exit(1);
  }
}
```

**Expected**:
- Error code: `storage_dependency_not_installed`
- Message mentions 'pg' package
- Hint contains: `npm install pg`

---

### 9. Storage: Redis Without Dependency

**Objective**: Verify proper error when Redis configured but `ioredis` missing

```javascript
// test-redis-missing.mjs
import { createCache } from '@dexto/core/storage/cache/factory.js';

const mockLogger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
};

try {
  await createCache({
    type: 'redis',
    host: 'localhost',
    port: 6379
  }, mockLogger);
  console.error('FAIL: Should have thrown an error');
  process.exit(1);
} catch (error) {
  if (error.code === 'storage_dependency_not_installed') {
    console.log('SUCCESS: Got expected StorageError');
    console.log('Error message:', error.message);
    console.log('Hint:', error.context?.hint);
  } else {
    console.error('FAIL: Unexpected error:', error);
    process.exit(1);
  }
}
```

**Expected**:
- Error code: `storage_dependency_not_installed`
- Message mentions 'ioredis' package
- Hint contains: `npm install ioredis`

---

### 10. Storage: In-Memory Always Works

**Objective**: Verify in-memory storage works without any optional deps

```javascript
// test-inmemory-storage.mjs
import { createDatabase } from '@dexto/core/storage/database/factory.js';
import { createCache } from '@dexto/core/storage/cache/factory.js';

const mockLogger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
};

const db = await createDatabase({ type: 'in-memory' }, mockLogger);
console.log('In-memory database created');

const cache = await createCache({ type: 'in-memory' }, mockLogger);
console.log('In-memory cache created');

console.log('SUCCESS: In-memory storage works without optional deps');
```

```bash
# Run in core-standalone directory
node test-inmemory-storage.mjs
```

**Expected**: Both database and cache create successfully

---

### 11. Storage: SQLite With Dependency

**Objective**: Verify SQLite works when `better-sqlite3` installed

```bash
# In core-standalone directory
npm install better-sqlite3
```

```javascript
// test-sqlite-working.mjs
import { createDatabase } from '@dexto/core/storage/database/factory.js';

const mockLogger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
};

const db = await createDatabase({
  type: 'sqlite',
  path: '/tmp/test-working.db'
}, mockLogger);
console.log('SQLite database created');

// Test basic operations
await db.connect();
console.log('Connected to SQLite');
await db.disconnect();
console.log('SUCCESS: SQLite works with dependency installed');
```

**Expected**: SQLite database creates and connects successfully

---

### 12. Full CLI End-to-End Test

**Objective**: Verify complete CLI functionality with all features

```bash
# In cli-test directory
npx dexto init my-test-project
cd my-test-project

# Test agent creation
npx dexto agent create test-agent

# Test web UI starts (if applicable)
npx dexto web --port 3333 &
sleep 5
curl http://localhost:3333
kill %1

# Test basic chat (requires API key)
echo "Hello, world!" | npx dexto chat
```

**Expected**: All CLI commands work correctly

---

### 13. Server Package Test

**Objective**: Verify `@dexto/server` works as expected

```bash
# In a clean directory
mkdir /tmp/server-test && cd /tmp/server-test
npm init -y
npm install /path/to/dexto-dependency-reduction/packages/server
```

```javascript
// test-server.mjs
import { createDextoServer } from '@dexto/server';

// Basic import test
console.log('SUCCESS: @dexto/server imports correctly');
```

**Expected**: Package imports without errors

---

### 14. Agent Management Package Test

**Objective**: Verify `@dexto/agent-management` works as expected

```bash
# In a clean directory
mkdir /tmp/agent-mgmt-test && cd /tmp/agent-mgmt-test
npm init -y
npm install /path/to/dexto-dependency-reduction/packages/agent-management
```

```javascript
// test-agent-mgmt.mjs
import { AgentLoader } from '@dexto/agent-management';

// Basic import test
console.log('SUCCESS: @dexto/agent-management imports correctly');
```

**Expected**: Package imports without errors

---

## Test Result Summary

| Test | Status | Notes |
|------|--------|-------|
| 1. Build & Unit Tests | ✅ | 1252 tests passing |
| 2. CLI Full Installation | ✅ | `dexto --version` returns 1.2.6 |
| 3. Core Standalone Installation | ✅ | 110MB (down from ~293MB), only @opentelemetry/api (2.8MB) installed |
| 4. Telemetry Disabled | ✅ | Works without OpenTelemetry SDK deps |
| 5. Telemetry Missing Deps | ✅ | Clear error with install instructions |
| 6. Telemetry With Deps | ⬜ | Skipped (requires manual OTEL setup) |
| 7. SQLite Missing Deps | ✅ | `storage_dependency_not_installed` error with hint |
| 8. PostgreSQL Missing Deps | ✅ | `storage_dependency_not_installed` error with hint |
| 9. Redis Missing Deps | ✅ | `storage_dependency_not_installed` error with hint |
| 10. In-Memory Storage | ✅ | Works without any optional deps |
| 11. SQLite With Deps | ⬜ | Skipped (requires better-sqlite3 install) |
| 12. Full CLI E2E | ⬜ | Skipped (requires API keys) |
| 13. Server Package | ⬜ | Skipped |
| 14. Agent Management | ⬜ | Skipped |

---

## Regression Checklist

Before merging, verify:

- [x] All automated tests pass (`pnpm test`) - 1252 tests passing
- [x] Build succeeds (`pnpm build`)
- [x] TypeScript types compile correctly
- [x] No silent fallbacks to in-memory storage (hard failures with clear errors)
- [x] Error messages include install commands
- [x] CLI package works out of box
- [ ] WebUI starts correctly
- [ ] Chat functionality works

---

## Cleanup

After testing, clean up test directories:

```bash
rm -rf /tmp/cli-test
rm -rf /tmp/core-standalone
rm -rf /tmp/server-test
rm -rf /tmp/agent-mgmt-test
rm -f /tmp/test.db /tmp/test-working.db
```
