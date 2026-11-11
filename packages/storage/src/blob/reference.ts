import { StorageError } from '@dexto/core';

/** Blob ids are the first 16 hex characters of the content's SHA-256 hash. */
const BLOB_ID_PATTERN = /^[0-9a-f]{16}$/;

/** Extract the blob id from `blob:<id>` or a bare id, rejecting anything that is not a blob id. */
export function parseBlobReference(reference: string): string {
    if (!reference) {
        throw StorageError.blobInvalidReference(reference, 'Empty reference');
    }

    const id = reference.startsWith('blob:') ? reference.substring(5) : reference;
    if (!id) {
        throw StorageError.blobInvalidReference(reference, 'Empty blob ID after prefix');
    }
    if (!BLOB_ID_PATTERN.test(id)) {
        throw StorageError.blobInvalidReference(reference, 'Blob ID is not a valid blob id');
    }
    return id;
}
