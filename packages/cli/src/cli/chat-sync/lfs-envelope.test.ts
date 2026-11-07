import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { packLfsEnvelope, unpackLfsEnvelope } from './lfs-envelope.js';

describe('LFS handoff envelope', () => {
    it('carries and verifies a git bundle and its LFS object', () => {
        const content = Buffer.from('LFS contents');
        const oid = createHash('sha256').update(content).digest('hex');
        const envelope = packLfsEnvelope(Buffer.from('bundle'), [{ oid, content }]);
        const result = unpackLfsEnvelope(envelope);
        expect(result.bundle.toString()).toBe('bundle');
        expect(result.objects).toEqual([{ oid, content }]);
        const last = envelope.at(-1);
        if (last === undefined) throw new Error('Expected an envelope.');
        envelope.writeUInt8(last ^ 1, envelope.length - 1);
        expect(() => unpackLfsEnvelope(envelope)).toThrow();
    });
});
