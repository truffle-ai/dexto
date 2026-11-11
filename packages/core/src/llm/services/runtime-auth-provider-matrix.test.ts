/// <reference lib="dom.iterable" />
/* global Request, Headers */
// Pins, for every fetch-based provider, that a runtime baseURL, runtime headers and the host's fetch hook
// are honored and nothing reaches the global fetch (a request that skipped the hook could carry the
// bearer to a provider default host).
import { generateText } from 'ai';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMConfigSchema } from '../schemas.js';
import { createVercelModel } from './factory.js';

const GATEWAY = 'https://gateway.test/v1';
const PROVIDERS = [
    ['openai', 'gpt-5'],
    ['openai-compatible', 'test'],
    ['anthropic', 'claude-sonnet-4-5'],
    ['google', 'gemini-2.5-flash'],
    ['groq', 'llama-3.3-70b-versatile'],
    ['xai', 'grok-4.3'],
    ['cohere', 'command-r-08-2024'],
    ['minimax', 'MiniMax-M2'],
    ['glm', 'glm-4.6'],
    ['openrouter', 'openai/gpt-4o'],
    ['litellm', 'x'],
    ['glama', 'openai/gpt-4o'],
    ['ollama', 'llama3'],
    ['dexto-nova', 'openai/gpt-4o'],
] as const;

const globalFetchCalls: string[] = [];
beforeEach(() => {
    globalFetchCalls.length = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
        globalFetchCalls.push(String(input instanceof Request ? input.url : input));
        return new Response('unreachable', { status: 500 });
    });
});
afterEach(() => vi.unstubAllGlobals());

describe.each(PROVIDERS)('%s runtime auth routing', (provider, modelId) => {
    it.each(['requestAuth', 'fetch'] as const)(
        'honors the runtime URL, headers and %s hook',
        async (mode) => {
            const seen: Array<{ url: string; headers: Headers }> = [];
            const hook = async (input: RequestInfo | URL, init?: RequestInit) => {
                const request = input instanceof Request ? input : undefined;
                seen.push({
                    url: String(request?.url ?? input),
                    headers: new Headers({
                        ...Object.fromEntries(new Headers(request?.headers)),
                        ...Object.fromEntries(new Headers(init?.headers)),
                    }),
                });
                return new Response('denied', { status: 401 });
            };
            const model = await createVercelModel(
                LLMConfigSchema.parse({ provider, model: modelId, apiKey: 'sk-test-key' }),
                {
                    authResolver: {
                        resolveRuntimeAuth: () => ({
                            baseURL: GATEWAY,
                            headers: { 'x-runtime': 'yes' },
                            ...(mode === 'requestAuth'
                                ? {
                                      requestAuth: {
                                          fetch: async (i, n) => ({
                                              response: await hook(i, n),
                                              provenance: 'p',
                                          }),
                                          isRetryableResponse: async () => false,
                                      },
                                  }
                                : { fetch: hook as typeof fetch }),
                        }),
                    },
                }
            );
            await generateText({ model, prompt: 'hi', maxRetries: 0 }).catch(() => {});

            expect(seen).toHaveLength(1);
            expect(seen[0]?.url.startsWith('https://gateway.test/')).toBe(true);
            expect(seen[0]?.headers.get('x-runtime')).toBe('yes');
            expect(globalFetchCalls).toEqual([]);
        }
    );
});

const vertexRequire = createRequire(import.meta.url);
const vertexAuthPath = vertexRequire.resolve('google-auth-library', {
    paths: [vertexRequire.resolve('@ai-sdk/google-vertex')],
});
vi.doMock(vertexAuthPath, () => ({
    GoogleAuth: class {
        async getClient() {
            return { getAccessToken: async () => ({ token: 'test-adc-token' }) };
        }
    },
}));

describe.each(['gemini-2.5-pro', 'claude-sonnet-4-5@20250929'] as const)(
    'Vertex %s runtime auth routing',
    (modelId) => {
        it.each(['requestAuth', 'fetch', 'requestAuth-with-authorization'] as const)(
            'honors the runtime URL, headers and %s hook',
            async (mode) => {
                const processStub = Object.create(globalThis.process);
                Object.defineProperty(processStub, 'env', {
                    value: { GOOGLE_VERTEX_PROJECT: 'test-project' },
                });
                vi.stubGlobal('process', processStub);
                const seen: Array<{ url: string; headers: Headers }> = [];
                const hook = async (input: RequestInfo | URL, init?: RequestInit) => {
                    const request = input instanceof globalThis.Request ? input : undefined;
                    seen.push({
                        url: String(request?.url ?? input),
                        headers: new globalThis.Headers(init?.headers ?? request?.headers),
                    });
                    return new Response('denied', { status: 401 });
                };
                const model = await createVercelModel(
                    LLMConfigSchema.parse({ provider: 'vertex', model: modelId }),
                    {
                        authResolver: {
                            resolveRuntimeAuth: () => ({
                                baseURL: GATEWAY,
                                headers: {
                                    'x-runtime': 'yes',
                                    ...(mode === 'requestAuth-with-authorization'
                                        ? { Authorization: 'Bearer host-token' }
                                        : {}),
                                },
                                ...(mode !== 'fetch'
                                    ? {
                                          requestAuth: {
                                              fetch: async (i, n) => ({
                                                  response: await hook(i, n),
                                                  provenance: 'p',
                                              }),
                                              isRetryableResponse: async () => false,
                                          },
                                      }
                                    : { fetch: hook }),
                            }),
                        },
                    }
                );
                await generateText({ model, prompt: 'hi', maxRetries: 0 }).catch(() => {});
                expect(seen).toHaveLength(1);
                expect(seen[0]?.url.startsWith('https://gateway.test/')).toBe(true);
                expect(seen[0]?.headers.get('x-runtime')).toBe('yes');
                expect(seen[0]?.headers.get('authorization')).toBe(
                    mode === 'requestAuth-with-authorization'
                        ? 'Bearer host-token'
                        : 'Bearer test-adc-token'
                );
                expect(globalFetchCalls).toEqual([]);
            }
        );
    }
);

describe.each(PROVIDERS)('%s blank runtime URL', (provider, modelId) => {
    it('fails closed instead of using a provider default', async () => {
        const config = LLMConfigSchema.parse({ provider, model: modelId, apiKey: 'sk-test-key' });
        await expect(
            createVercelModel(config, {
                authResolver: { resolveRuntimeAuth: () => ({ baseURL: '  ' }) },
            })
        ).rejects.toMatchObject({ code: 'llm_base_url_invalid' });
        expect(globalFetchCalls).toEqual([]);
    });
});
