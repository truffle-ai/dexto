// The few public Dexto `/v1` reads the sign-in needs, until @dexto/cloud-client (DEXTO-2035).

import { z } from 'zod';

export interface CloudProject {
    readonly id: string;
    readonly name: string;
    readonly isDefault: boolean;
    readonly archived: boolean;
}

const ProjectListSchema = z.object({
    data: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            is_default: z.boolean(),
            archived_at: z.string().nullable(),
        })
    ),
});

/** The Cloud projects of the token's organization: `GET /v1/projects`. */
export async function listCloudProjects(
    fetch: typeof globalThis.fetch,
    apiBaseUrl: string,
    token: string
): Promise<CloudProject[]> {
    const response = await fetch(`${apiBaseUrl}/v1/projects`, {
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Couldn't list Cloud projects: HTTP ${response.status}.`);
    return ProjectListSchema.parse(await response.json()).data.map((project) => ({
        id: project.id,
        name: project.name,
        isDefault: project.is_default,
        archived: project.archived_at !== null,
    }));
}
