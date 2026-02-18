#!/usr/bin/env bun
/**
 * Publish all public packages in the Changesets fixed-version groups using Bun (no npm/pnpm).
 *
 * Why this exists:
 * - Dexto uses Changesets for versioning + changelogs, but `changeset publish` only supports npm/pnpm.
 * - We want Bun to be the package manager + runtime end-to-end, including releases.
 *
 * Behavior:
 * - Publishes in topological order based on workspace dependencies.
 * - Skips packages whose current version is already published.
 * - Creates git tags for published packages: `<name>@<version>` (e.g. `@dexto/core@1.2.3`).
 * - Uses prerelease dist-tag from `.changeset/pre.json` when present; defaults to `latest`.
 *
 * Requirements:
 * - NPM auth must be configured (e.g. `NODE_AUTH_TOKEN` + ~/.npmrc).
 * - Packages must already be built (CI runs `bun run build` before this).
 */

import fs from 'node:fs';
import path from 'node:path';
import { $ } from 'bun';

type ChangesetsConfig = {
    fixed?: string[][];
};

type WorkspacePackage = {
    name: string;
    version: string;
    dir: string;
    private: boolean;
    dependencies: Record<string, string>;
    optionalDependencies: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonFile(filePath: string): unknown {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function getChangesetsConfig(rootDir: string): ChangesetsConfig {
    const configPath = path.join(rootDir, '.changeset/config.json');
    const raw = readJsonFile(configPath);
    if (!isRecord(raw)) {
        throw new Error('Invalid .changeset/config.json (expected an object)');
    }
    return raw as ChangesetsConfig;
}

function getFixedGroupPackageNames(rootDir: string): string[] {
    const config = getChangesetsConfig(rootDir);
    const fixed = Array.isArray(config.fixed) ? config.fixed : [];
    const names = new Set<string>();
    for (const group of fixed) {
        if (!Array.isArray(group)) continue;
        for (const name of group) {
            if (typeof name === 'string' && name.length > 0) {
                names.add(name);
            }
        }
    }
    return [...names].sort();
}

function getWorkspacePackages(rootDir: string): Map<string, WorkspacePackage> {
    const packagesDir = path.join(rootDir, 'packages');
    const entries = fs.existsSync(packagesDir)
        ? fs.readdirSync(packagesDir, { withFileTypes: true })
        : [];

    const map = new Map<string, WorkspacePackage>();
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pkgDir = path.join(packagesDir, entry.name);
        const pkgJsonPath = path.join(pkgDir, 'package.json');
        if (!fs.existsSync(pkgJsonPath)) continue;

        const raw = readJsonFile(pkgJsonPath);
        if (!isRecord(raw)) continue;

        const pkg = raw as Record<string, unknown>;
        const name = typeof pkg.name === 'string' ? pkg.name : undefined;
        const version = typeof pkg.version === 'string' ? pkg.version : undefined;
        if (!name || !version) continue;

        map.set(name, {
            name,
            version,
            dir: path.join('packages', entry.name),
            private: pkg.private === true,
            dependencies:
                pkg.dependencies && typeof pkg.dependencies === 'object'
                    ? (pkg.dependencies as Record<string, string>)
                    : {},
            optionalDependencies:
                pkg.optionalDependencies && typeof pkg.optionalDependencies === 'object'
                    ? (pkg.optionalDependencies as Record<string, string>)
                    : {},
        });
    }

    return map;
}

function resolvePublishOrder(
    packages: Map<string, WorkspacePackage>,
    publishSet: Set<string>
): WorkspacePackage[] {
    // Build dependency graph within the publish set
    const indegree = new Map<string, number>();
    const dependents = new Map<string, Set<string>>();

    for (const name of publishSet) {
        indegree.set(name, 0);
        dependents.set(name, new Set());
    }

    for (const name of publishSet) {
        const pkg = packages.get(name);
        if (!pkg) continue;
        const depNames = new Set([
            ...Object.keys(pkg.dependencies),
            ...Object.keys(pkg.optionalDependencies),
        ]);

        for (const depName of depNames) {
            if (!publishSet.has(depName)) continue;

            // name depends on depName
            indegree.set(name, (indegree.get(name) ?? 0) + 1);
            dependents.get(depName)?.add(name);
        }
    }

    const queue: string[] = [];
    for (const [name, deg] of indegree.entries()) {
        if (deg === 0) queue.push(name);
    }
    queue.sort();

    const ordered: WorkspacePackage[] = [];
    while (queue.length > 0) {
        const name = queue.shift();
        if (!name) break;

        const pkg = packages.get(name);
        if (!pkg) {
            throw new Error(`Workspace package '${name}' not found under ./packages`);
        }
        ordered.push(pkg);

        for (const dependent of dependents.get(name) ?? []) {
            const next = (indegree.get(dependent) ?? 0) - 1;
            indegree.set(dependent, next);
            if (next === 0) {
                queue.push(dependent);
                queue.sort();
            }
        }
    }

    if (ordered.length !== publishSet.size) {
        const remaining = [...publishSet].filter((n) => (indegree.get(n) ?? 0) > 0).sort();
        throw new Error(
            `Could not compute publish order (cycle detected). Remaining: ${remaining.join(', ')}`
        );
    }

    return ordered;
}

function getNpmTag(rootDir: string): string {
    if (process.env.NPM_TAG && process.env.NPM_TAG.trim().length > 0) {
        return process.env.NPM_TAG.trim();
    }

    const prePath = path.join(rootDir, '.changeset/pre.json');
    if (!fs.existsSync(prePath)) return 'latest';

    try {
        const raw = readJsonFile(prePath);
        if (!isRecord(raw)) return 'latest';
        const tag = raw.tag;
        if (typeof tag === 'string' && tag.trim().length > 0) {
            return tag.trim();
        }
    } catch {
        // ignore
    }
    return 'latest';
}

function isAlreadyPublishedError(stderr: string): boolean {
    return (
        stderr.includes('cannot publish over') ||
        stderr.includes('You cannot publish over the previously published versions') ||
        stderr.toLowerCase().includes('cannot publish over the previously published version')
    );
}

async function publishWithBun(
    pkg: WorkspacePackage,
    tag: string
): Promise<'published' | 'skipped'> {
    const pkgDir = path.join(process.cwd(), pkg.dir);

    const args = ['publish', '--tag', tag];
    if (pkg.name.startsWith('@')) {
        args.push('--access', 'public');
    }

    const result = await $`bun ${{ raw: args.map($.escape).join(' ') }}`.cwd(pkgDir).nothrow();
    if (result.exitCode === 0) {
        return 'published';
    }

    const stderr = result.stderr.toString();
    if (isAlreadyPublishedError(stderr)) {
        return 'skipped';
    }

    throw new Error(`Failed to publish ${pkg.name}:\n${stderr}`);
}

async function tagIfMissing(tagName: string): Promise<void> {
    const exists = await $`git rev-parse -q --verify refs/tags/${tagName}`.nothrow();
    if (exists.exitCode === 0) return;
    await $`git tag ${tagName}`;
}

async function main(): Promise<void> {
    const rootDir = process.cwd();

    if (!fs.existsSync(path.join(rootDir, 'packages/cli/package.json'))) {
        throw new Error('Must run from repository root');
    }

    // Ensure local tags are up to date to avoid push failures when tags already exist on remote.
    await $`git fetch --tags`;

    const publishNames = getFixedGroupPackageNames(rootDir);
    if (publishNames.length === 0) {
        throw new Error('No packages found in .changeset/config.json fixed groups');
    }

    const allPackages = getWorkspacePackages(rootDir);

    const publishSet = new Set<string>();
    for (const name of publishNames) {
        const pkg = allPackages.get(name);
        if (!pkg) {
            throw new Error(`Changesets fixed-group package '${name}' not found under ./packages`);
        }
        if (pkg.private) {
            throw new Error(
                `Changesets fixed-group package '${name}' is marked private and cannot be published`
            );
        }
        publishSet.add(name);
    }

    const publishOrder = resolvePublishOrder(allPackages, publishSet);
    const npmTag = getNpmTag(rootDir);

    console.log(`📦 Publishing ${publishOrder.length} package(s) with tag "${npmTag}"...`);

    const publishedTags: string[] = [];
    for (const pkg of publishOrder) {
        process.stdout.write(`  • ${pkg.name}@${pkg.version} ... `);
        const res = await publishWithBun(pkg, npmTag);
        if (res === 'published') {
            console.log('published');
            const tagName = `${pkg.name}@${pkg.version}`;
            await tagIfMissing(tagName);
            publishedTags.push(tagName);
        } else {
            console.log('skipped (already published)');
        }
    }

    if (publishedTags.length > 0) {
        console.log(`🏷️  Created ${publishedTags.length} tag(s). Pushing tags...`);
        for (const tagName of publishedTags) {
            await $`git push origin ${tagName}`;
        }
    } else {
        console.log('✅ Nothing new to publish.');
    }
}

main().catch((err) => {
    console.error(`❌ Publish failed:`, err);
    process.exit(1);
});
