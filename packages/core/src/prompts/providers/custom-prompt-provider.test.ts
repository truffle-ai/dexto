import { describe, test, expect, beforeAll } from 'vitest';
import { CustomPromptProvider } from './custom-prompt-provider.js';
import { MemoryDatabaseStore } from '@dexto/storage';

const mockLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    silly: () => {},
    trackException: () => {},
    createChild: () => mockLogger,
    destroy: async () => {},
} as any;

describe('CustomPromptProvider', () => {
    let db: MemoryDatabaseStore;
    const resourceManagerStub = { getBlobStore: () => undefined } as any;

    beforeAll(async () => {
        db = new MemoryDatabaseStore();
        await db.connect();
    });

    test('appends Context at END when no placeholders', async () => {
        const provider = new CustomPromptProvider(db as any, resourceManagerStub, mockLogger);
        await provider.createPrompt({ name: 'c1', content: 'Simple content' });
        const res = await provider.getPrompt('c1', { _context: 'CTX' } as any);
        const text = (res.messages?.[0]?.content as any).text as string;
        expect(text).toBe('Simple content\n\nContext: CTX');
    });

    test('replaces named placeholders and does not append when used', async () => {
        const provider = new CustomPromptProvider(db as any, resourceManagerStub, mockLogger);
        await provider.createPrompt({
            name: 'c2',
            content: 'Process: {{data}} with mode {{mode}}',
            arguments: [{ name: 'data', required: true }, { name: 'mode' }],
        });
        const res = await provider.getPrompt('c2', {
            data: 'dataset',
            mode: 'fast',
            _context: 'CTX',
        } as any);
        const text = (res.messages?.[0]?.content as any).text as string;
        expect(text).toBe('Process: dataset with mode fast');
    });
});
