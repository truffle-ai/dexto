// Resolve from the installed CLI, including npm's nested global dependency layout.
// EXPECT_SQLITE_DRIVER, when set, is the driver this Node.js must end up with: better-sqlite3 where
// it has a prebuilt binary (Node.js 20, 22 and 24), node:sqlite where npm skipped it (Node.js 26).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import { openSqlite, SQLiteStore } from '@dexto/storage';
import { createLogger } from '@dexto/core';

const logger = createLogger({
    agentId: 'beta-install',
    config: { level: 'error', transports: [] },
});
const store = new SQLiteStore({ type: 'sqlite', path: '/tmp/beta-install.sqlite' }, logger);
try {
    await store.connect();
    await store.set('beta-install', { answer: 42 });
    assert.deepEqual(await store.get('beta-install'), { answer: 42 });
} finally {
    await store.disconnect();
}
const probe = await openSqlite('/tmp/beta-install.sqlite', {
    readonly: true,
    fileMustExist: true,
    timeoutMs: 0,
});
const driver = probe.driver;
probe.close();
const expected = process.env.EXPECT_SQLITE_DRIVER;
if (expected) assert.equal(driver, expected, `SQLite driver on Node.js ${process.versions.node}`);
if (driver === 'better-sqlite3') {
    for (const entry of [
        import.meta.resolve('@dexto/storage'),
        import.meta.resolve('@dexto/core'),
    ]) {
        const require = createRequire(entry);
        const pkg = JSON.parse(
            readFileSync(require.resolve('better-sqlite3/package.json'), 'utf8')
        );
        assert.match(pkg.version, /^12\.9\./);
    }
}
console.log(`SQLite read/write on Node.js ${process.versions.node} through ${driver}: PASS`);
