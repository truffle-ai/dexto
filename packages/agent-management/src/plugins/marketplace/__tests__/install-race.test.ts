/**
 * Installing from a marketplace while another process keeps swapping the plugin directory between
 * the real directory and a link to a folder outside the marketplace. Everything is real: a temp
 * HOME, a real marketplace, a separate flipper process and real installs. A unique marker in the
 * outside files must never reach the plugin cache or the installed plugin.
 *
 * RACE_ITERATIONS and RACE_FLIP_US override the bounded defaults for manual measurement.
 */

import { spawn, type ChildProcess } from 'child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPluginFromMarketplace } from '../install-from-marketplace.js';

const MARKER = `outside-marker-${process.pid}-${Date.now()}`;
const iterations = Number(process.env.RACE_ITERATIONS ?? 40);
const flipMicroseconds = Number(process.env.RACE_FLIP_US ?? 50);

const FLIPPER = `
const fs = require('fs');
const [link, outside, spinMicros] = process.argv.slice(2);
const store = link + '.real';
const swapLink = link + '.lnk';
fs.symlinkSync(outside, swapLink);
let isLink = false;
const spin = (micros) => {
    const end = process.hrtime.bigint() + BigInt(micros) * 1000n;
    while (process.hrtime.bigint() < end);
};
process.on('SIGTERM', () => process.exit(0));
setInterval(() => {}, 1 << 30);
(function loop() {
    for (;;) {
        try {
            if (!isLink) {
                fs.renameSync(link, store);
                fs.renameSync(swapLink, link);
            } else {
                fs.renameSync(link, swapLink);
                fs.renameSync(store, link);
            }
            isLink = !isLink;
        } catch {}
        spin(Number(spinMicros));
    }
})();
`;

function filesContaining(dir: string, marker: string): string[] {
    const found: string[] = [];
    const walk = (current: string) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && readFileSync(full, 'utf-8').includes(marker)) {
                found.push(full);
            }
        }
    };
    walk(dir);
    return found;
}

function writePluginTree(root: string, content: string) {
    mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
    writeFileSync(
        path.join(root, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'foo', version: '1.0.0', description: content })
    );
    writeFileSync(path.join(root, 'readme.txt'), content);
    mkdirSync(path.join(root, 'skills'));
    writeFileSync(path.join(root, 'skills', 'one.md'), content);
    writeFileSync(path.join(root, 'skills', 'two.md'), content);
}

describe.skipIf(process.platform === 'win32')('installPluginFromMarketplace race', () => {
    let home: string;
    let pluginDir: string;
    let flipper: ChildProcess | undefined;

    beforeEach(() => {
        home = mkdtempSync(path.join(tmpdir(), 'marketplace-race-'));
        vi.stubEnv('HOME', home);
        vi.stubEnv('USERPROFILE', home);
        const marketplaceDir = path.join(home, 'marketplace');
        const outside = path.join(home, 'outside');
        pluginDir = path.join(marketplaceDir, 'plugins', 'foo');
        // The outside folder has the same layout as the plugin, so a swap during the copy can
        // pick up outside content under a name the listing already contained.
        writePluginTree(pluginDir, 'inside');
        writePluginTree(outside, MARKER);
        writeFileSync(
            path.join(marketplaceDir, 'marketplace.json'),
            JSON.stringify({ name: 'Test', plugins: [{ name: 'foo', source: './plugins/foo' }] })
        );
        mkdirSync(path.join(home, '.dexto', 'plugins'), { recursive: true });
        writeFileSync(
            path.join(home, '.dexto', 'plugins', 'known_marketplaces.json'),
            JSON.stringify({
                version: 1,
                marketplaces: {
                    test: {
                        name: 'test',
                        source: { type: 'local', value: marketplaceDir },
                        installLocation: marketplaceDir,
                        lastUpdated: new Date().toISOString(),
                    },
                },
            })
        );
    });

    afterEach(() => {
        flipper?.kill('SIGKILL');
        flipper = undefined;
        vi.unstubAllEnvs();
        rmSync(home, { recursive: true, force: true });
    });

    it(
        'never copies outside content while the plugin directory is being swapped',
        { timeout: 120_000 },
        async () => {
            const flipperScript = path.join(home, 'flipper.cjs');
            writeFileSync(flipperScript, FLIPPER);
            flipper = spawn(
                process.execPath,
                [flipperScript, pluginDir, path.join(home, 'outside'), String(flipMicroseconds)],
                { stdio: ['ignore', 'ignore', 'inherit'] }
            );
            await new Promise((resolve) => setTimeout(resolve, 300));

            const pluginsRoot = path.join(home, '.dexto', 'plugins');
            let leaks = 0;
            let installs = 0;
            for (let attempt = 0; attempt < iterations; attempt++) {
                rmSync(path.join(pluginsRoot, 'cache'), { recursive: true, force: true });
                rmSync(path.join(pluginsRoot, 'foo'), { recursive: true, force: true });
                try {
                    await installPluginFromMarketplace('foo@test', { force: true });
                    installs++;
                } catch {
                    // A refused copy is the expected outcome of losing the race.
                }
                const leaked = filesContaining(path.join(home, '.dexto'), MARKER);
                if (leaked.length > 0) leaks++;
            }

            flipper.kill('SIGKILL');
            console.log(
                `RACE RESULT iterations=${iterations} flipUs=${flipMicroseconds} installs=${installs} leaks=${leaks}`
            );
            expect(leaks).toBe(0);
        }
    );
});
