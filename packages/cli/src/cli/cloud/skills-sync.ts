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
    const present = new Set(await skillFolders(directory));
    const listed = new Set(released.map((skill) => skill.slug));
    // What is on disk now, so a sync cut short (the session-start timeout) still keeps what landed.
    const synced = Object.fromEntries(
        Object.entries(await readSynced(directory)).filter(
            ([slug]) => present.has(slug) && listed.has(slug)
        )
    );

    const downloaded: string[] = [];
    const failed: string[] = [];
    let reason = '';
    for (const skill of released) {
        if (synced[skill.slug]?.digest === skill.digest) continue;
        try {
            await downloadSkill(client, directory, skill);
        } catch (error) {
            failed.push(skill.slug);
            reason ||= error instanceof Error ? error.message : String(error);
            continue;
        }
        synced[skill.slug] = { digest: skill.digest };
        await writeSynced(directory, synced);
        downloaded.push(skill.slug);
    }

    const removed = [...present].filter((slug) => !listed.has(slug));
    for (const slug of removed)
        await rm(path.join(directory, slug), { force: true, recursive: true });
    await writeSynced(directory, synced);
    if (failed.length > 0) throw new Error(`Couldn't download ${failed.join(', ')}: ${reason}`);
    return { downloaded, removed };
}

async function writeSynced(directory: string, synced: z.output<typeof SyncedSchema>) {
    await writeFile(path.join(directory, SYNCED_FILE), `${JSON.stringify(synced, null, 2)}\n`);
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
