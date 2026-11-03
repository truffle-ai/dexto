// Keeps a copy of the signed-in person's Cloud Skills library on disk, where local skill discovery
// finds it after every local Skill (`getStandaloneSkillPaths().cloud`).

import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { dextoGateway, getStandaloneSkillPaths } from '@dexto/agent-management';
import { createCloudClient, unwrap, type CloudClient } from '@dexto/cloud-client';
import { getDextoGlobalPath } from '@dexto/core';
import { x as untar } from 'tar';
import { z } from 'zod';

import { resolveConnection, type ConnectionOverrides } from './connection.js';

/** What was synced, by slug, so the next sync downloads only Skills whose files changed. */
const SYNCED_FILE = '.synced.json';
const SyncedSchema = z.record(z.string(), z.object({ digest: z.string() }));
/** A slug that is safe as one folder name. */
const SLUG = /^[a-z0-9][a-z0-9._-]{0,79}$/u;

export interface SyncedSkills {
    readonly downloaded: readonly string[];
    readonly removed: readonly string[];
}

/** Mirrors the library into `directory`: one folder per released Skill, named by its slug. */
export async function syncCloudSkills(input: {
    client: CloudClient;
    directory: string;
}): Promise<SyncedSkills> {
    const { client, directory } = input;
    const library = await unwrap(await client.GET('/v1/skills'));
    const released = library.data.flatMap((skill) =>
        skill.release === null || !SLUG.test(skill.slug)
            ? []
            : [{ digest: skill.release.digest, id: skill.id, slug: skill.slug }]
    );
    await mkdir(directory, { recursive: true });
    const synced = await readSynced(directory);
    const present = new Set(await skillFolders(directory));

    const downloaded: string[] = [];
    const next: z.output<typeof SyncedSchema> = {};
    for (const skill of released) {
        if (synced[skill.slug]?.digest !== skill.digest || !present.has(skill.slug)) {
            await downloadSkill(client, directory, skill);
            downloaded.push(skill.slug);
        }
        next[skill.slug] = { digest: skill.digest };
    }

    const removed = [...present].filter((slug) => next[slug] === undefined);
    for (const slug of removed)
        await rm(path.join(directory, slug), { force: true, recursive: true });
    await writeFile(path.join(directory, SYNCED_FILE), `${JSON.stringify(next, null, 2)}\n`);
    return { downloaded, removed };
}

/** Unpacks next to the old copy, then swaps it in, so a failed download keeps the last one. */
async function downloadSkill(
    client: CloudClient,
    directory: string,
    skill: { id: string; slug: string }
): Promise<void> {
    const bytes = await unwrap(
        await client.GET('/v1/skills/{skill_id}/bundle', {
            params: { path: { skill_id: skill.id } },
            parseAs: 'arrayBuffer',
        })
    );
    const incoming = path.join(directory, `.incoming-${skill.slug}`);
    await rm(incoming, { force: true, recursive: true });
    await mkdir(incoming);
    try {
        await new Promise<void>((resolve, reject) => {
            const unpack = untar({ cwd: incoming, strict: true });
            unpack.on('close', resolve);
            unpack.on('error', reject);
            unpack.end(Buffer.from(bytes));
        });
        const target = path.join(directory, skill.slug);
        await rm(target, { force: true, recursive: true });
        await rename(incoming, target);
    } finally {
        await rm(incoming, { force: true, recursive: true });
    }
}

async function readSynced(directory: string): Promise<z.output<typeof SyncedSchema>> {
    // A missing or unreadable record only means every Skill downloads again.
    try {
        return SyncedSchema.parse(
            JSON.parse(await readFile(path.join(directory, SYNCED_FILE), 'utf8'))
        );
    } catch {
        return {};
    }
}

async function skillFolders(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name);
}

const NO_OVERRIDES: ConnectionOverrides = {
    apiBaseUrl: null,
    apiKey: null,
    cloudProject: null,
    profile: null,
};
/** How long a session waits on the sync before starting with the last copy. */
const START_SYNC_TIMEOUT_MS = 5_000;

/**
 * At session start: syncs a signed-in person's Skills, and forgets the last person's Skills when no
 * person is signed in. Never fails the session: a failed sync warns once and keeps the last copy.
 */
export async function syncCloudSkillsAtStart(): Promise<void> {
    const directory = getStandaloneSkillPaths().cloud;
    const signal = AbortSignal.timeout(START_SYNC_TIMEOUT_MS);
    try {
        const connection = await resolveConnection({
            dir: getDextoGlobalPath('accounts'),
            environment: process.env,
            overrides: NO_OVERRIDES,
            refresh: dextoGateway.defaultDextoGatewayOptions().refresh,
        });
        if (connection?.kind !== 'oauth') {
            await rm(directory, { force: true, recursive: true });
            return;
        }
        await syncCloudSkills({
            client: createCloudClient({
                apiBaseUrl: connection.apiBaseUrl,
                cloudProject: null,
                fetch: (request, init) => globalThis.fetch(request, { ...init, signal }),
                token: connection.token,
            }),
            directory,
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        process.stderr.write(
            `Couldn't sync your Dexto Skills (${reason}). Using the last synced copy; run dexto skills sync to retry.\n`
        );
    }
}
