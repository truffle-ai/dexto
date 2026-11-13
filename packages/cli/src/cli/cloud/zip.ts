// Writes a .zip of files, as Dexto takes files to publish: each deflated unless that's no smaller.

import { crc32, deflateRawSync } from 'node:zlib';

const encoder = new globalThis.TextEncoder();
/** 1980-01-01, the first date a .zip can hold, so the same files make the same archive. */
const DOS_DATE = 0x21;
/** Entry names are UTF-8. */
const UTF8_FLAG = 0x0800;

export interface ZipFile {
    readonly bytes: Uint8Array;
    /** Relative, with `/` between folders. */
    readonly path: string;
}

/** The archive of these files in order, with its central directory. */
export function zipArchive(files: readonly ZipFile[]): Uint8Array<ArrayBuffer> {
    const parts: Uint8Array[] = [];
    const directory: Uint8Array[] = [];
    let offset = 0;
    for (const file of files) {
        const name = encoder.encode(file.path);
        const deflated = deflateRawSync(file.bytes);
        const stored = deflated.byteLength >= file.bytes.byteLength;
        const body = stored ? file.bytes : deflated;
        const entry = {
            checksum: crc32(file.bytes),
            method: stored ? 0 : 8,
            nameLength: name.byteLength,
            size: body.byteLength,
            unpackedSize: file.bytes.byteLength,
        };
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        writeEntryFields(local, 4, entry);
        parts.push(new Uint8Array(local.buffer), name, body);

        const central = new DataView(new ArrayBuffer(46));
        central.setUint32(0, 0x02014b50, true);
        central.setUint16(4, 20, true);
        writeEntryFields(central, 6, entry);
        central.setUint32(42, offset, true);
        directory.push(new Uint8Array(central.buffer), name);
        offset += 30 + name.byteLength + body.byteLength;
    }
    const directorySize = directory.reduce((total, part) => total + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, offset, true);
    return concat([...parts, ...directory, new Uint8Array(end.buffer)]);
}

/** The fields a local header and a central directory entry share, from the version needed on. */
function writeEntryFields(
    view: DataView,
    at: number,
    entry: {
        checksum: number;
        method: number;
        nameLength: number;
        size: number;
        unpackedSize: number;
    }
): void {
    view.setUint16(at, 20, true);
    view.setUint16(at + 2, UTF8_FLAG, true);
    view.setUint16(at + 4, entry.method, true);
    view.setUint16(at + 6, 0, true);
    view.setUint16(at + 8, DOS_DATE, true);
    view.setUint32(at + 10, entry.checksum, true);
    view.setUint32(at + 14, entry.size, true);
    view.setUint32(at + 18, entry.unpackedSize, true);
    view.setUint16(at + 22, entry.nameLength, true);
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
    let at = 0;
    for (const part of parts) {
        out.set(part, at);
        at += part.byteLength;
    }
    return out;
}
