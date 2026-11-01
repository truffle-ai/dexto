import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { dextoPackageRange } from './scaffolding-utils.js';

const roots: string[] = [];

async function writePackage(dir: string, name: string, version: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version }));
}

/** An installed dexto 2.0 beta whose @dexto/* packages keep their own 1.x versions. */
async function installedCli(layout: 'nested' | 'hoisted'): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dexto-range-'));
    roots.push(root);
    const cli = path.join(root, 'node_modules', 'dexto');
    await writePackage(cli, 'dexto', '2.0.0-beta.3');
    const modules =
        layout === 'nested' ? path.join(cli, 'node_modules') : path.join(root, 'node_modules');
    await writePackage(path.join(modules, '@dexto', 'core'), '@dexto/core', '1.14.4');
    await writePackage(
        path.join(modules, '@dexto', 'image-local'),
        '@dexto/image-local',
        '1.15.0-beta.3'
    );
    return cli;
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('dextoPackageRange', () => {
    it.each(['nested', 'hoisted'] as const)(
        "asks for each @dexto package's own installed version, not the CLI's (%s install)",
        async (layout) => {
            const cli = await installedCli(layout);
            expect(dextoPackageRange('@dexto/core', cli)).toBe('^1.14.4');
            expect(dextoPackageRange('@dexto/image-local', cli)).toBe('^1.15.0-beta.3');
        }
    );

    it("gives a package the CLI doesn't install @dexto/core's version, its fixed group", async () => {
        const cli = await installedCli('nested');
        expect(dextoPackageRange('@dexto/image-bundler', cli)).toBe('^1.14.4');
    });

    it("fails when it can't find @dexto/core next to the CLI", async () => {
        const root = await mkdtemp(path.join(os.tmpdir(), 'dexto-range-'));
        roots.push(root);
        await writePackage(root, 'dexto', '2.0.0-beta.3');
        expect(() => dextoPackageRange('@dexto/core', root)).toThrow(/@dexto\/core/);
    });
});
