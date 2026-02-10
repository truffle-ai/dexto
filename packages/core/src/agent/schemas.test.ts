import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AgentCardSchema, type AgentCard, type ValidatedAgentCard } from './schemas.js';

describe('AgentCardSchema', () => {
    const validAgentCard: AgentCard = {
        name: 'TestAgent',
        description: 'A test agent for validation',
        url: 'https://agent.example.com',
        version: '1.0.0',
    };

    describe('Basic Structure Validation', () => {
        it('should accept valid minimal config', () => {
            const result = AgentCardSchema.parse(validAgentCard);

            expect(result.name).toBe('TestAgent');
            expect(result.url).toBe('https://agent.example.com');
            expect(result.version).toBe('1.0.0');
        });

        it('should apply default values', () => {
            const result = AgentCardSchema.parse(validAgentCard);

            expect(result.protocolVersion).toBe('0.3.0');
            expect(result.preferredTransport).toBe('JSONRPC');
            expect(result.description).toBe('A test agent for validation');
            expect(result.capabilities.streaming).toBe(true);
            expect(result.capabilities.stateTransitionHistory).toBe(false);
            expect(result.defaultInputModes).toEqual(['application/json', 'text/plain']);
            expect(result.defaultOutputModes).toEqual([
                'application/json',
                'text/event-stream',
                'text/plain',
            ]);
            expect(result.skills).toHaveLength(1);
            expect(result.skills[0]!.id).toBe('chat_with_agent');
        });

        it('should preserve explicit values', () => {
            const config: AgentCard = {
                ...validAgentCard,
                description: 'Custom description',
                capabilities: {
                    streaming: false,
                    pushNotifications: true,
                    stateTransitionHistory: true,
                },
                metadata: {
                    dexto: {
                        authentication: {
                            schemes: ['bearer', 'api-key'],
                            credentials: 'optional-creds',
                        },
                    },
                },
                defaultInputModes: ['text/plain'],
                defaultOutputModes: ['application/json'],
                skills: [
                    {
                        id: 'custom-skill',
                        name: 'Custom Skill',
                        description: 'A custom skill',
                        tags: ['custom'],
                        inputModes: ['application/json'],
                        outputModes: ['text/plain'],
                    },
                ],
            };

            const result = AgentCardSchema.parse(config);

            expect(result.description).toBe('Custom description');
            expect(result.capabilities.streaming).toBe(false);
            expect(result.capabilities.pushNotifications).toBe(true);
            expect(result.capabilities.stateTransitionHistory).toBe(true);
            expect(result.metadata?.dexto?.authentication?.schemes).toEqual(['bearer', 'api-key']);
            expect(result.metadata?.dexto?.authentication?.credentials).toBe('optional-creds');
            expect(result.defaultInputModes).toEqual(['text/plain']);
            expect(result.defaultOutputModes).toEqual(['application/json']);
            expect(result.skills).toHaveLength(1);
            expect(result.skills[0]!.id).toBe('custom-skill');
        });
    });

    describe('Required Fields Validation', () => {
        it('should require name field', () => {
            const config = { ...validAgentCard };
            delete (config as any).name;

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['name']);
        });

        it('should require url field', () => {
            const config = { ...validAgentCard };
            delete (config as any).url;

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['url']);
        });

        it('should require version field', () => {
            const config = { ...validAgentCard };
            delete (config as any).version;

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['version']);
        });
    });

    describe('URL Validation', () => {
        it('should accept valid URLs', () => {
            const validUrls = [
                'https://example.com',
                'http://localhost:8080',
                'https://agent.company.com/v1',
            ];

            for (const url of validUrls) {
                const config = { ...validAgentCard, url };
                const result = AgentCardSchema.safeParse(config);
                expect(result.success).toBe(true);
            }
        });

        it('should reject invalid URLs', () => {
            const invalidUrls = ['not-a-url', 'just-text', ''];

            for (const url of invalidUrls) {
                const config = { ...validAgentCard, url };
                const result = AgentCardSchema.safeParse(config);
                expect(result.success).toBe(false);
            }
        });

        it('should validate provider.url when provider is specified', () => {
            const config: AgentCard = {
                ...validAgentCard,
                provider: {
                    organization: 'Test Corp',
                    url: 'invalid-url',
                },
            };

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['provider', 'url']);
        });

        it('should validate documentationUrl when specified', () => {
            const config: AgentCard = {
                ...validAgentCard,
                documentationUrl: 'not-a-url',
            };

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['documentationUrl']);
        });
    });

    describe('Skills Validation', () => {
        it('should validate skill structure', () => {
            const config: AgentCard = {
                ...validAgentCard,
                skills: [
                    {
                        id: 'test-skill',
                        name: 'Test Skill',
                        description: 'A test skill',
                        tags: ['test', 'demo'],
                    },
                ],
            };

            const result = AgentCardSchema.parse(config);
            expect(result.skills[0]!.inputModes).toEqual(['text/plain']); // default
            expect(result.skills[0]!.outputModes).toEqual(['text/plain']); // default
        });

        it('should require skill fields', () => {
            const config: AgentCard = {
                ...validAgentCard,
                skills: [
                    {
                        id: 'test-skill',
                        name: 'Test Skill',
                        // Missing description and tags
                    } as any,
                ],
            };

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
        });
    });

    describe('Strict Validation', () => {
        it('should reject unknown fields', () => {
            const config: any = {
                ...validAgentCard,
                unknownField: 'should-fail',
            };

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
        });

        it('should reject unknown fields in nested objects', () => {
            const config: any = {
                ...validAgentCard,
                capabilities: {
                    streaming: true,
                    unknownCapability: true,
                },
            };

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
        });
    });

    describe('Type Safety', () => {
        it('should handle input and output types correctly', () => {
            const input: AgentCard = validAgentCard;
            const result: ValidatedAgentCard = AgentCardSchema.parse(input);

            // Should have applied defaults
            expect(result.description).toBeTruthy();
            expect(result.capabilities).toBeDefined();

            // Should preserve input values
            expect(result.name).toBe(input.name);
            expect(result.url).toBe(input.url);
            expect(result.version).toBe(input.version);
        });
    });

    describe('Security Schemes Validation', () => {
        it('should validate apiKey security scheme', () => {
            const config: AgentCard = {
                ...validAgentCard,
                securitySchemes: {
                    apiKey: {
                        type: 'apiKey',
                        name: 'X-API-Key',
                        in: 'header',
                    },
                },
            };

            const result = AgentCardSchema.parse(config);
            expect(result.securitySchemes?.apiKey).toBeDefined();
            if (result.securitySchemes?.apiKey) {
                expect(result.securitySchemes.apiKey.type).toBe('apiKey');
            }
        });

        it('should require name and in for apiKey type', () => {
            const config: any = {
                ...validAgentCard,
                securitySchemes: {
                    apiKey: {
                        type: 'apiKey',
                        // Missing name and in
                    },
                },
            };

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
        });

        it('should validate http security scheme', () => {
            const config: AgentCard = {
                ...validAgentCard,
                securitySchemes: {
                    bearer: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'JWT',
                    },
                },
            };

            const result = AgentCardSchema.parse(config);
            expect(result.securitySchemes?.bearer).toBeDefined();
            if (result.securitySchemes?.bearer) {
                expect(result.securitySchemes.bearer.type).toBe('http');
            }
        });

        it('should require scheme for http type', () => {
            const config: any = {
                ...validAgentCard,
                securitySchemes: {
                    http: {
                        type: 'http',
                        // Missing scheme
                    },
                },
            };

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
        });

        it('should validate oauth2 security scheme', () => {
            const config: AgentCard = {
                ...validAgentCard,
                securitySchemes: {
                    oauth: {
                        type: 'oauth2',
                        flows: {
                            authorizationCode: {
                                authorizationUrl: 'https://auth.example.com/oauth/authorize',
                                tokenUrl: 'https://auth.example.com/oauth/token',
                                scopes: {
                                    read: 'Read access',
                                    write: 'Write access',
                                },
                            },
                        },
                    },
                },
            };

            const result = AgentCardSchema.parse(config);
            expect(result.securitySchemes?.oauth).toBeDefined();
            if (result.securitySchemes?.oauth) {
                expect(result.securitySchemes.oauth.type).toBe('oauth2');
            }
        });

        it('should validate openIdConnect security scheme', () => {
            const config: AgentCard = {
                ...validAgentCard,
                securitySchemes: {
                    oidc: {
                        type: 'openIdConnect',
                        openIdConnectUrl:
                            'https://accounts.google.com/.well-known/openid-configuration',
                    },
                },
            };

            const result = AgentCardSchema.parse(config);
            expect(result.securitySchemes?.oidc).toBeDefined();
            if (result.securitySchemes?.oidc) {
                expect(result.securitySchemes.oidc.type).toBe('openIdConnect');
            }
        });

        it('should require openIdConnectUrl for openIdConnect type', () => {
            const config: any = {
                ...validAgentCard,
                securitySchemes: {
                    oidc: {
                        type: 'openIdConnect',
                        // Missing openIdConnectUrl
                    },
                },
            };

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
        });

        it('should validate mutualTLS security scheme', () => {
            const config: AgentCard = {
                ...validAgentCard,
                securitySchemes: {
                    mtls: {
                        type: 'mutualTLS',
                    },
                },
            };

            const result = AgentCardSchema.parse(config);
            expect(result.securitySchemes?.mtls).toBeDefined();
            if (result.securitySchemes?.mtls) {
                expect(result.securitySchemes.mtls.type).toBe('mutualTLS');
            }
        });
    });

    describe('Metadata and Extensions', () => {
        it('should support dexto metadata extensions', () => {
            const config: AgentCard = {
                ...validAgentCard,
                metadata: {
                    dexto: {
                        delegation: {
                            protocol: 'a2a-jsonrpc',
                            endpoint: '/delegate',
                            supportsSession: true,
                            supportsStreaming: true,
                        },
                        owner: {
                            userId: 'user123',
                            username: 'testuser',
                            email: 'test@example.com',
                        },
                    },
                },
            };

            const result = AgentCardSchema.parse(config);
            expect(result.metadata?.dexto?.delegation?.protocol).toBe('a2a-jsonrpc');
            expect(result.metadata?.dexto?.owner?.userId).toBe('user123');
        });

        it('should support custom metadata namespaces', () => {
            const config: AgentCard = {
                ...validAgentCard,
                metadata: {
                    dexto: {},
                    customExtension: {
                        foo: 'bar',
                        nested: { key: 'value' },
                    },
                },
            };

            const result = AgentCardSchema.parse(config);
            expect(result.metadata?.customExtension).toBeDefined();
        });

        it('should validate signatures field', () => {
            const config: AgentCard = {
                ...validAgentCard,
                signatures: [
                    {
                        protected: 'eyJhbGciOiJSUzI1NiJ9',
                        signature:
                            'cC4hiUPoj9Eetdgtv3hF80EGrhuB__dzERat0XF9g2VtQgr9PJbu3XOiZj5RZmh7',
                    },
                ],
            };

            const result = AgentCardSchema.parse(config);
            expect(result.signatures).toHaveLength(1);
            expect(result.signatures![0]!.protected).toBe('eyJhbGciOiJSUzI1NiJ9');
        });
    });

    describe('Required Description Field', () => {
        it('should require description field', () => {
            const config = {
                name: 'TestAgent',
                url: 'https://agent.example.com',
                version: '1.0.0',
                // Missing description
            };

            const result = AgentCardSchema.safeParse(config);
            expect(result.success).toBe(false);
            expect(result.error?.issues[0]?.path).toEqual(['description']);
        });
    });
});
