// Resolve from the installed CLI, including npm's nested global dependency layout.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import console from 'node:console';
import { SQLiteStore } from '@dexto/storage';
import { createLogger } from '@dexto/core';

const logger = createLogger({ agentId: 'beta-install', config: { level: 'error', transports: [] } });
const store = new SQLiteStore({ type: 'sqlite', path: '/tmp/beta-install.sqlite' }, logger);
try {
    await store.connect();
    await store.set('beta-install', { answer: 42 });
    assert.deepEqual(await store.get('beta-install'), { answer: 42 });
} finally {
    await store.disconnect();
}
for (const entry of [import.meta.resolve('@dexto/storage'), import.meta.resolve('@dexto/core')]) {
    const require = createRequire(entry);
    const pkg = JSON.parse(readFileSync(require.resolve('better-sqlite3/package.json'), 'utf8'));
    assert.match(pkg.version, /^12\.9\./);
    console.log(`SQLite through ${entry}: better-sqlite3 ${pkg.version} PASS`);
}
