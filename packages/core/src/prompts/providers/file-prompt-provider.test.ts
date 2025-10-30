import { describe, test, expect } from 'vitest';
import { FilePromptProvider } from './file-prompt-provider.js';

function makeProvider() {
    const resourceManagerStub = { getBlobStore: () => undefined } as any;
    const provider = new FilePromptProvider({ resourceManager: resourceManagerStub });
    return provider;
}

describe('FilePromptProvider.applyArguments (unit)', () => {
    test('expands $ARGUMENTS and does not append context when placeholders used', async () => {
        const provider = makeProvider();
        // Prime caches manually
        (provider as any).promptsCache = [
            { name: 'p1', description: 't', source: 'file', metadata: {} },
        ];
        (provider as any).inlineContent = new Map<string, string>([
            ['p1', 'Title\n\nContent: $ARGUMENTS'],
        ]);
        (provider as any).promptResources = new Map();
        (provider as any).cacheValid = true;

        const res = await provider.getPrompt('p1', {
            _positional: ['one', 'two'],
            _context: 'should-not-append',
        });

        const text = (res.messages?.[0]?.content as any).text as string;
        expect(text).toContain('Content: one two');
        expect(text.includes('should-not-append')).toBe(false);
    });

    test('appends Context at END when no placeholders', async () => {
        const provider = makeProvider();
        (provider as any).promptsCache = [
            { name: 'np', description: 't', source: 'file', metadata: {} },
        ];
        (provider as any).inlineContent = new Map<string, string>([['np', 'Simple content']]);
        (provider as any).promptResources = new Map();
        (provider as any).cacheValid = true;

        const res = await provider.getPrompt('np', { _context: 'CTX' });
        const text = (res.messages?.[0]?.content as any).text as string;
        expect(text).toBe('Simple content\n\nContext: CTX');
    });

    test('appends Arguments at END when no placeholders and no context', async () => {
        const provider = makeProvider();
        (provider as any).promptsCache = [
            { name: 'np2', description: 't', source: 'file', metadata: {} },
        ];
        (provider as any).inlineContent = new Map<string, string>([['np2', 'Alpha']]);
        (provider as any).promptResources = new Map();
        (provider as any).cacheValid = true;

        const res = await provider.getPrompt('np2', { a: '1', b: '2' } as any);
        const text = (res.messages?.[0]?.content as any).text as string;
        expect(text).toBe('Alpha\n\nArguments: a: 1, b: 2');
    });
});
