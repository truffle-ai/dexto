import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

/** Deterministic, runtime-portable SHA-256 fingerprint for identity and contract drift. */
export function stableFingerprint(value: string): string {
    return bytesToHex(sha256(value));
}
