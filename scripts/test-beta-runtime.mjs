// Resolve from the installed CLI, including npm's nested global dependency layout.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const cliRequire = createRequire(`${process.argv[2]}/package.json`);
const storageEntry = cliRequire.resolve('@dexto/storage');
const { SQLiteStore } = await import(pathToFileURL(storageEntry).href);
const { createLogger } = await import(pathToFileURL(cliRequire.resolve('@dexto/core')).href);
const logger = createLogger({ agentId: 'beta-install', config: { level: 'error', transports: [] } });
const store = new SQLiteStore({ type: 'sqlite', path: '/tmp/beta-install.sqlite' }, logger);
try {
    await store.connect();
    await store.set('beta-install', { answer: 42 });
    assert.deepEqual(await store.get('beta-install'), { answer: 42 });
} finally {
    await store.disconnect();
}
for (const entry of [storageEntry, cliRequire.resolve('@dexto/core')]) {
    const require = createRequire(entry);
    const pkg = JSON.parse(readFileSync(require.resolve('better-sqlite3/package.json'), 'utf8'));
    assert.match(pkg.version, /^12\.9\./);
    console.log(`SQLite through ${entry}: better-sqlite3 ${pkg.version} PASS`);
}
