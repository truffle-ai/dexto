import { createHash } from 'node:crypto';
import { z } from 'zod';
import { spawn } from 'node:child_process';

const MAGIC = Buffer.from('dexto-lfs-v1\n');
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_HEADER = 1024 * 1024;
const Manifest = z
    .object({
        bundleSize: z.number().int().nonnegative().max(MAX_BYTES),
        objects: z.array(
            z
                .object({
                    oid: z.string().regex(/^[0-9a-f]{64}$/u),
                    size: z.number().int().nonnegative().max(MAX_BYTES),
                })
                .strict()
        ),
    })
    .strict();

type LfsObject = { readonly oid: string; readonly content: Buffer };

export function isLfsEnvelope(bytes: Buffer): boolean {
    return bytes.subarray(0, MAGIC.length).equals(MAGIC);
}

export async function installLfsObjects(
    repository: string,
    objects: readonly LfsObject[]
): Promise<void> {
    for (const object of objects) {
        await new Promise<void>((resolve, reject) => {
            const child = spawn('git', ['lfs', 'clean', '--', 'dexto-lfs-object'], {
                cwd: repository,
                stdio: ['pipe', 'pipe', 'ignore'],
            });
            const chunks: Buffer[] = [];
            child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
            child.stdin.on('error', reject);
            child.on('error', reject);
            child.on('close', (code) => {
                const pointer = Buffer.concat(chunks).toString('utf8');
                if (code !== 0 || !pointer.includes(`oid sha256:${object.oid}\n`))
                    reject(new Error(`Could not install LFS object ${object.oid}.`));
                else resolve();
            });
            child.stdin.end(object.content);
        });
    }
}

function verifyObject(object: LfsObject): void {
    if (createHash('sha256').update(object.content).digest('hex') !== object.oid)
        throw new Error(`LFS object ${object.oid} has an invalid checksum.`);
}

export function packLfsEnvelope(bundle: Buffer, objects: readonly LfsObject[]): Buffer {
    for (const object of objects) verifyObject(object);
    const header = Buffer.from(
        JSON.stringify({
            bundleSize: bundle.length,
            objects: objects.map(({ oid, content }) => ({ oid, size: content.length })),
        })
    );
    const total =
        MAGIC.length +
        4 +
        header.length +
        bundle.length +
        objects.reduce((n, object) => n + object.content.length, 0);
    if (header.length > MAX_HEADER || total > MAX_BYTES)
        throw new Error('LFS handoff exceeds 256 MiB.');
    const headerSize = Buffer.alloc(4);
    headerSize.writeUInt32BE(header.length);
    return Buffer.concat(
        [MAGIC, headerSize, header, bundle, ...objects.map((object) => object.content)],
        total
    );
}

export function unpackLfsEnvelope(bytes: Buffer): { bundle: Buffer; objects: LfsObject[] } {
    if (
        bytes.length > MAX_BYTES ||
        bytes.length < MAGIC.length + 4 ||
        !bytes.subarray(0, MAGIC.length).equals(MAGIC)
    )
        throw new Error('Invalid LFS handoff envelope.');
    const headerSize = bytes.readUInt32BE(MAGIC.length);
    const start = MAGIC.length + 4;
    if (headerSize > MAX_HEADER || start + headerSize > bytes.length)
        throw new Error('Invalid LFS handoff header.');
    const manifest = Manifest.parse(
        JSON.parse(bytes.subarray(start, start + headerSize).toString('utf8'))
    );
    let offset = start + headerSize;
    if (offset + manifest.bundleSize > bytes.length) throw new Error('Truncated handoff bundle.');
    const bundle = bytes.subarray(offset, offset + manifest.bundleSize);
    offset += manifest.bundleSize;
    const objects: LfsObject[] = [];
    const seen = new Set<string>();
    for (const { oid, size } of manifest.objects) {
        if (seen.has(oid) || offset + size > bytes.length)
            throw new Error('Invalid LFS object entry.');
        seen.add(oid);
        const object = { oid, content: bytes.subarray(offset, offset + size) };
        verifyObject(object);
        objects.push(object);
        offset += size;
    }
    if (offset !== bytes.length) throw new Error('Unexpected bytes in LFS handoff.');
    return { bundle, objects };
}
