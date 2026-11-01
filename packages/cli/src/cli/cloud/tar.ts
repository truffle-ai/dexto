// Writes a POSIX ustar archive as Dexto's Skill bundle import reads one: files, PAX for long paths.

const BLOCK_BYTES = 512;
const encoder = new globalThis.TextEncoder();

export interface TarFile {
    readonly bytes: Uint8Array;
    readonly executable: boolean;
    /** Relative, with `/` between segments. */
    readonly path: string;
}

/** The archive of these files in order, closed by its two empty blocks. */
export function tarArchive(files: readonly TarFile[]): Uint8Array<ArrayBuffer> {
    const blocks: Uint8Array[] = [];
    for (const [index, file] of files.entries()) {
        // A path past the 100-byte name field rides in a PAX header for the entry after it.
        const pax = paxPathBody(file.path);
        if (pax !== null)
            blocks.push(
                tarHeader({
                    mode: 0o644,
                    name: `PaxHeaders/${index}`,
                    size: pax.length,
                    type: 'x',
                }),
                pax,
                padding(pax.length)
            );
        blocks.push(
            tarHeader({
                mode: file.executable ? 0o755 : 0o644,
                name: pax === null ? file.path : `file-${index}`,
                size: file.bytes.length,
                type: '0',
            }),
            file.bytes,
            padding(file.bytes.length)
        );
    }
    blocks.push(new Uint8Array(BLOCK_BYTES * 2));
    return Buffer.concat(blocks);
}

function tarHeader(input: { mode: number; name: string; size: number; type: '0' | 'x' }) {
    const header = new Uint8Array(BLOCK_BYTES);
    writeText(header, 0, 100, input.name);
    writeOctal(header, 100, 8, input.mode);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, input.size);
    writeOctal(header, 136, 12, 0);
    // The checksum counts its own field as spaces.
    header.fill(0x20, 148, 156);
    writeText(header, 156, 1, input.type);
    writeText(header, 257, 6, 'ustar');
    writeText(header, 263, 2, '00');
    const checksum = header.reduce((total, byte) => total + byte, 0);
    writeText(header, 148, 6, checksum.toString(8).padStart(6, '0'));
    header[154] = 0;
    header[155] = 0x20;
    return header;
}

function writeText(target: Uint8Array, offset: number, length: number, value: string) {
    const bytes = encoder.encode(value);
    if (bytes.length > length) throw new Error(`Tar header value is too long: ${value}`);
    target.set(bytes, offset);
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number) {
    writeText(target, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

/** `<length> path=<path>\n`, whose length counts its own digits; null when the name field fits. */
function paxPathBody(path: string): Uint8Array | null {
    if (encoder.encode(path).length <= 100) return null;
    let length = encoder.encode(` path=${path}\n`).length + 1;
    for (;;) {
        const record = encoder.encode(`${length} path=${path}\n`);
        if (record.length === length) return record;
        length = record.length;
    }
}

function padding(size: number): Uint8Array {
    return new Uint8Array(Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES - size);
}
