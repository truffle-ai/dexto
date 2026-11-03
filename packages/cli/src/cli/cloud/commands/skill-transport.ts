import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CommandFailure } from '../../failure.js';
import type { CommandContext } from '../command.js';
import { sendBytes } from '../transfer.js';
import { queryWorkspaceTool } from './workspace.js';

const Prepared = z.object({
    headers: z.record(z.string(), z.string()),
    method: z.string(),
    path: z.string(),
    url: z.string(),
});
type Metadata = { description: string; slug: string; title: string; confirm?: true } & (
    | { mode: 'update'; importProvenance?: never }
    | {
          mode: 'create';
          importProvenance?: {
              sourceAgent: 'claude_code' | 'codex';
              sourceId: string;
              sourcePath: string;
          };
      }
);

/** Upload one bundle and invoke the typed create/update operation exactly once. */
export async function uploadSkillBundle(
    context: CommandContext,
    archive: Uint8Array<ArrayBuffer>,
    metadata: Metadata
): Promise<unknown> {
    const prepared = Prepared.safeParse(
        await queryWorkspaceTool(context, 'dexto_upload_prepare', {
            filename: `${metadata.slug}.tar`,
            mimeType: 'application/x-tar',
            purpose: 'skill-bundle',
            sha256: createHash('sha256').update(archive).digest('hex'),
            sizeBytes: archive.length,
        })
    );
    if (!prepared.success)
        throw new CommandFailure('failed', "Dexto didn't say where to upload the bundle.", null);
    const { headers, method, url } = prepared.data;
    await sendBytes(context, { headers, method, url }, new globalThis.Blob([archive]));
    return await queryWorkspaceTool(context, 'dexto_skill_bundle_import', {
        ...metadata,
        uploadPath: prepared.data.path,
    });
}
