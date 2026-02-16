import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
    StdioServerConfigSchema,
    SseServerConfigSchema,
    HttpServerConfigSchema,
    McpServerConfigSchema,
    ServersConfigSchema,
    type StdioServerConfig,
    type SseServerConfig,
    type HttpServerConfig,
    type McpServerConfig,
    type ServersConfig,
} from './schemas.js';
import { MCPErrorCode } from './error-codes.js';

describe('MCP Schemas', () => {
    describe('StdioServerConfigSchema', () => {
        describe('Basic Validation', () => {
            it('should accept valid minimal config', () => {
                const config: StdioServerConfig = {
                    type: 'stdio',
                    command: 'node',
                    args: ['server.js'],
                };

                const result = StdioServerConfigSchema.parse(config);
                expect(result.type).toBe('stdio');
                expect((result as any).command).toBe('node');
                expect(result.args).toEqual(['server.js']);
            });

            it('should apply default values', () => {
                const config: StdioServerConfig = {
                    type: 'stdio',
                    command: 'node',
                };

                const result = StdioServerConfigSchema.parse(config);
                expect(result.args).toEqual([]); // default
                expect(result.env).toEqual({}); // default
                expect(result.timeout).toBe(30000); // default
                expect(result.connectionMode).toBe('lenient'); // default
            });

            it('should accept all optional fields', () => {
                const config: StdioServerConfig = {
                    type: 'stdio',
                    command: 'python',
                    args: ['-m', 'my_server'],
                    env: { PYTHONPATH: '/custom/path', DEBUG: '1' },
                    timeout: 45000,
                    connectionMode: 'strict',
                };

                const result = StdioServerConfigSchema.parse(config);
                expect(result.args).toEqual(['-m', 'my_server']);
                expect(result.env).toEqual({ PYTHONPATH: '/custom/path', DEBUG: '1' });
                expect(result.timeout).toBe(45000);
                expect(result.connectionMode).toBe('strict');
            });
        });

        describe('Field Validation', () => {
            it('should require command field', () => {
                const config = {
                    type: 'stdio',
                    args: ['server.js'],
                };
                const result = StdioServerConfigSchema.safeParse(config);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
                expect(result.error?.issues[0]?.path).toEqual(['command']);
            });

            it('should reject empty command', () => {
                const config = {
                    type: 'stdio',
                    command: '',
                };
                const result = StdioServerConfigSchema.safeParse(config);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.custom);
                expect((result.error?.issues[0] as any)?.params?.code).toBe(
                    MCPErrorCode.COMMAND_MISSING
                );
            });

            it('should validate connectionMode values', () => {
                const validModes = ['strict', 'lenient'];

                for (const connectionMode of validModes) {
                    const config = {
                        type: 'stdio',
                        command: 'node',
                        connectionMode,
                    };
                    const result = StdioServerConfigSchema.safeParse(config);
                    expect(result.success).toBe(true);
                }

                const invalidConfig = {
                    type: 'stdio',
                    command: 'node',
                    connectionMode: 'invalid',
                };
                const result = StdioServerConfigSchema.safeParse(invalidConfig);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_enum_value);
                expect(result.error?.issues[0]?.path).toEqual(['connectionMode']);
            });

            it('should validate field types', () => {
                // Command must be string
                const invalidCommand = { type: 'stdio', command: 123 };
                let result = StdioServerConfigSchema.safeParse(invalidCommand);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
                expect(result.error?.issues[0]?.path).toEqual(['command']);

                // Args must be array
                const invalidArgs = { type: 'stdio', command: 'node', args: 'not-array' };
                result = StdioServerConfigSchema.safeParse(invalidArgs);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
                expect(result.error?.issues[0]?.path).toEqual(['args']);

                // Env must be object
                const invalidEnv = { type: 'stdio', command: 'node', env: ['not-object'] };
                result = StdioServerConfigSchema.safeParse(invalidEnv);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
                expect(result.error?.issues[0]?.path).toEqual(['env']);

                // Timeout must be positive number
                const invalidTimeout = { type: 'stdio', command: 'node', timeout: 'fast' };
                result = StdioServerConfigSchema.safeParse(invalidTimeout);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
                expect(result.error?.issues[0]?.path).toEqual(['timeout']);
            });
        });

        describe('Strict Validation', () => {
            it('should reject unknown fields', () => {
                const config = {
                    type: 'stdio',
                    command: 'node',
                    unknownField: 'should-fail',
                };
                const result = StdioServerConfigSchema.safeParse(config);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
            });
        });
    });

    describe('SseServerConfigSchema', () => {
        describe('Basic Validation', () => {
            it('should accept valid minimal config', () => {
                const config: SseServerConfig = {
                    type: 'sse',
                    url: 'http://localhost:8080/events',
                };

                const result = SseServerConfigSchema.parse(config);
                expect(result.type).toBe('sse');
                expect(result.url).toBe('http://localhost:8080/events');
            });

            it('should apply default values', () => {
                const config: SseServerConfig = {
                    type: 'sse',
                    url: 'https://api.example.com/sse',
                };

                const result = SseServerConfigSchema.parse(config);
                expect(result.headers).toEqual({}); // default
                expect(result.timeout).toBe(30000); // default
                expect(result.connectionMode).toBe('lenient'); // default
            });

            it('should accept all optional fields', () => {
                const config: SseServerConfig = {
                    type: 'sse',
                    url: 'https://api.example.com/events',
                    headers: {
                        Authorization: 'Bearer token123',
                        'X-API-Key': 'key456',
                    },
                    timeout: 60000,
                    connectionMode: 'strict',
                };

                const result = SseServerConfigSchema.parse(config);
                expect(result.headers).toEqual({
                    Authorization: 'Bearer token123',
                    'X-API-Key': 'key456',
                });
                expect(result.timeout).toBe(60000);
                expect(result.connectionMode).toBe('strict');
            });
        });

        describe('Field Validation', () => {
            it('should require url field', () => {
                const config = {
                    type: 'sse',
                    headers: {},
                };
                const result = SseServerConfigSchema.safeParse(config);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
                expect(result.error?.issues[0]?.path).toEqual(['url']);
            });

            it('should validate URL format', () => {
                const validUrls = [
                    'http://localhost:8080/events',
                    'https://api.example.com/sse',
                    'http://127.0.0.1:3000/stream',
                ];

                for (const url of validUrls) {
                    const config = { type: 'sse', url };
                    const result = SseServerConfigSchema.safeParse(config);
                    expect(result.success).toBe(true);
                }

                const invalidConfig = {
                    type: 'sse',
                    url: 'not-a-valid-url',
                };
                const result = SseServerConfigSchema.safeParse(invalidConfig);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.custom);
                expect(result.error?.issues[0]?.path).toEqual(['url']);
            });

            it('should validate connectionMode values', () => {
                const validModes = ['strict', 'lenient'];

                for (const connectionMode of validModes) {
                    const config = {
                        type: 'sse',
                        url: 'http://localhost:8080/events',
                        connectionMode,
                    };
                    const result = SseServerConfigSchema.safeParse(config);
                    expect(result.success).toBe(true);
                }

                const invalidConfig = {
                    type: 'sse',
                    url: 'http://localhost:8080/events',
                    connectionMode: 'invalid',
                };
                const result = SseServerConfigSchema.safeParse(invalidConfig);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_enum_value);
                expect(result.error?.issues[0]?.path).toEqual(['connectionMode']);
            });

            it('should validate field types', () => {
                // URL must be string
                const invalidUrl = { type: 'sse', url: 12345 };
                let result = SseServerConfigSchema.safeParse(invalidUrl);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
                expect(result.error?.issues[0]?.path).toEqual(['url']);

                // Headers must be object
                const invalidHeaders = {
                    type: 'sse',
                    url: 'http://localhost',
                    headers: 'not-object',
                };
                result = SseServerConfigSchema.safeParse(invalidHeaders);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
                expect(result.error?.issues[0]?.path).toEqual(['headers']);

                // Timeout must be positive number
                const invalidTimeout = { type: 'sse', url: 'http://localhost', timeout: 'slow' };
                result = SseServerConfigSchema.safeParse(invalidTimeout);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
                expect(result.error?.issues[0]?.path).toEqual(['timeout']);
            });
        });

        describe('Strict Validation', () => {
            it('should reject unknown fields', () => {
                const config = {
                    type: 'sse',
                    url: 'http://localhost:8080/events',
                    unknownField: 'should-fail',
                };
                const result = SseServerConfigSchema.safeParse(config);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
            });
        });
    });

    describe('HttpServerConfigSchema', () => {
        describe('Basic Validation', () => {
            it('should accept valid minimal config', () => {
                const config: HttpServerConfig = {
                    type: 'http',
                    url: 'http://localhost:9000/api',
                };

                const result = HttpServerConfigSchema.parse(config);
                expect(result.type).toBe('http');
                expect(result.url).toBe('http://localhost:9000/api');
            });

            it('should apply default values', () => {
                const config: HttpServerConfig = {
                    type: 'http',
                    url: 'https://api.example.com/mcp',
                };

                const result = HttpServerConfigSchema.parse(config);
                expect(result.connectionMode).toBe('lenient'); // default
            });

            it('should accept all optional fields', () => {
                const config: HttpServerConfig = {
                    type: 'http',
                    url: 'https://api.example.com/mcp',
                    headers: {
                        Authorization: 'Bearer token789',
                        'Content-Type': 'application/json',
                    },
                    timeout: 25000,
                    connectionMode: 'strict',
                };

                const result = HttpServerConfigSchema.parse(config);
                expect(result.headers).toEqual({
                    Authorization: 'Bearer token789',
                    'Content-Type': 'application/json',
                });
                expect(result.timeout).toBe(25000);
                expect(result.connectionMode).toBe('strict');
            });
        });

        describe('Field Validation', () => {
            it('should require url field', () => {
                const config = {
                    type: 'http',
                    headers: {},
                };
                const result = HttpServerConfigSchema.safeParse(config);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
                expect(result.error?.issues[0]?.path).toEqual(['url']);
            });

            it('should validate URL format', () => {
                const validUrls = [
                    'http://localhost:9000/api',
                    'https://api.example.com/mcp',
                    'http://127.0.0.1:4000/webhook',
                ];

                for (const url of validUrls) {
                    const config = { type: 'http', url };
                    const result = HttpServerConfigSchema.safeParse(config);
                    expect(result.success).toBe(true);
                }

                const invalidConfig = {
                    type: 'http',
                    url: 'invalid-url-format',
                };
                const result = HttpServerConfigSchema.safeParse(invalidConfig);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.custom);
                expect(result.error?.issues[0]?.path).toEqual(['url']);
            });

            it('should validate connectionMode values', () => {
                const validModes = ['strict', 'lenient'];

                for (const connectionMode of validModes) {
                    const config = {
                        type: 'http',
                        url: 'http://localhost:9000/api',
                        connectionMode,
                    };
                    const result = HttpServerConfigSchema.safeParse(config);
                    expect(result.success).toBe(true);
                }

                const invalidConfig = {
                    type: 'http',
                    url: 'http://localhost:9000/api',
                    connectionMode: 'invalid',
                };
                const result = HttpServerConfigSchema.safeParse(invalidConfig);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_enum_value);
                expect(result.error?.issues[0]?.path).toEqual(['connectionMode']);
            });

            it('should validate field types', () => {
                // URL must be valid URL format
                const invalidUrl = { type: 'http', url: 'not-a-url' };
                let result = HttpServerConfigSchema.safeParse(invalidUrl);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.custom);
                expect(result.error?.issues[0]?.path).toEqual(['url']);

                // Headers must be object
                const invalidHeaders = {
                    type: 'http',
                    url: 'http://localhost',
                    headers: 'not-object',
                };
                result = HttpServerConfigSchema.safeParse(invalidHeaders);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.invalid_type);
                expect(result.error?.issues[0]?.path).toEqual(['headers']);

                // Timeout must be positive number
                const invalidTimeout = { type: 'http', url: 'http://localhost', timeout: false };
                result = HttpServerConfigSchema.safeParse(invalidTimeout);
                expect(result.success).toBe(false);
                // weird behaviour, but this is how zod works for coerce
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.too_small);
                expect(result.error?.issues[0]?.path).toEqual(['timeout']);
            });
        });

        describe('Strict Validation', () => {
            it('should reject unknown fields', () => {
                const config = {
                    type: 'http',
                    url: 'http://localhost:9000/api',
                    unknownField: 'should-fail',
                };
                const result = HttpServerConfigSchema.safeParse(config);
                expect(result.success).toBe(false);
                expect(result.error?.issues[0]?.code).toBe(z.ZodIssueCode.unrecognized_keys);
            });
        });
    });

    describe('McpServerConfigSchema (Discriminated Union)', () => {
        describe('Type Discrimination', () => {
            it('should accept valid stdio server config', () => {
                const config: McpServerConfig = {
                    type: 'stdio',
                    command: 'node',
                    args: ['mcp-server.js'],
                };

                const result = McpServerConfigSchema.parse(config);
                expect(result.type).toBe('stdio');
                expect((result as StdioServerConfig).command).toBe('node');
            });

            it('should accept valid sse server config', () => {
                const config: McpServerConfig = {
                    type: 'sse',
                    url: 'http://localhost:8080/sse',
                };

                const result = McpServerConfigSchema.parse(config);
                expect(result.type).toBe('sse');
                expect((result as SseServerConfig).url).toBe('http://localhost:8080/sse');
            });

            it('should accept valid http server config', () => {
                const config: McpServerConfig = {
                    type: 'http',
                    url: 'http://localhost:9000/mcp',
                };

                const result = McpServerConfigSchema.parse(config);
                expect(result.type).toBe('http');
                expect((result as HttpServerConfig).url).toBe('http://localhost:9000/mcp');
            });
        });

        describe('Error Handling', () => {
            it('should reject config without type field', () => {
                const config = {
                    command: 'node',
                    args: ['server.js'],
                };
                expect(() => McpServerConfigSchema.parse(config)).toThrow();
            });

            it('should reject config with invalid type', () => {
                const config = {
                    type: 'invalid-type', // Invalid type
                    url: 'ws://localhost:8080',
                };
                expect(() => McpServerConfigSchema.parse(config)).toThrow();
            });

            it('should reject config with valid type but wrong fields', () => {
                const config = {
                    type: 'stdio',
                    url: 'http://localhost', // Wrong field for stdio
                };
                expect(() => McpServerConfigSchema.parse(config)).toThrow();
            });
        });
    });

    describe('ServersConfigSchema', () => {
        describe('Basic Validation', () => {
            it('should accept empty server configs', () => {
                const configs: ServersConfig = {};
                const result = ServersConfigSchema.parse(configs);
                expect(result).toEqual({});
            });

            it('should accept single server config', () => {
                const configs: ServersConfig = {
                    myServer: {
                        type: 'stdio',
                        command: 'node',
                        args: ['server.js'],
                    },
                };

                const result = ServersConfigSchema.parse(configs);
                expect(result.myServer!.type).toBe('stdio');
                expect((result.myServer! as any).command).toBe('node');
            });

            it('should accept multiple mixed server configs', () => {
                const configs: ServersConfig = {
                    stdioServer: {
                        type: 'stdio',
                        command: 'python',
                        args: ['-m', 'my_server'],
                        env: { DEBUG: '1' },
                    },
                    sseServer: {
                        type: 'sse',
                        url: 'http://localhost:8080/events',
                        headers: { Authorization: 'Bearer token' },
                    },
                    httpServer: {
                        type: 'http',
                        url: 'https://api.example.com/mcp',
                        timeout: 20000,
                    },
                };

                const result = ServersConfigSchema.parse(configs);
                expect(Object.keys(result)).toHaveLength(3);
                expect(result.stdioServer!.type).toBe('stdio');
                expect(result.sseServer!.type).toBe('sse');
                expect(result.httpServer!.type).toBe('http');
            });
        });

        describe('Validation Propagation', () => {
            it('should validate each server config individually', () => {
                const configs = {
                    validServer: {
                        type: 'stdio',
                        command: 'node',
                        args: ['server.js'],
                    },
                    invalidServer: {
                        type: 'stdio',
                        // Missing required command field
                        args: ['server.js'],
                    },
                };

                expect(() => ServersConfigSchema.parse(configs)).toThrow();
            });

            it('should reject configs with invalid server types', () => {
                const configs = {
                    server1: {
                        type: 'stdio',
                        command: 'node',
                    },
                    server2: {
                        type: 'invalid-type', // Invalid type
                        command: 'python',
                    },
                };

                expect(() => ServersConfigSchema.parse(configs)).toThrow();
            });
        });

        describe('Real-world Scenarios', () => {
            it('should handle typical development setup', () => {
                const devConfig = {
                    fileSystem: {
                        type: 'stdio',
                        command: 'npx',
                        args: ['@modelcontextprotocol/server-filesystem', '/path/to/project'],
                        env: { NODE_ENV: 'development' },
                        timeout: 10000,
                    },
                    database: {
                        type: 'sse',
                        url: 'http://localhost:8080/db-events',
                        headers: { 'X-API-Key': 'dev-key-123' },
                        connectionMode: 'lenient',
                    },
                };

                const result = ServersConfigSchema.parse(devConfig);
                expect(result.fileSystem!.type).toBe('stdio');
                expect(result.database!.type).toBe('sse');
            });

            it('should handle production setup', () => {
                const prodConfig = {
                    analytics: {
                        type: 'http',
                        url: 'https://analytics.company.com/mcp/endpoint',
                        headers: {
                            Authorization: 'Bearer prod-token-xyz',
                            'X-Service': 'dexto-agent',
                        },
                        timeout: 30000,
                        connectionMode: 'strict',
                    },
                    monitoring: {
                        type: 'sse',
                        url: 'https://monitoring.company.com/stream',
                        headers: { 'X-Monitor-Key': 'monitor-key-789' },
                        connectionMode: 'strict',
                    },
                };

                const result = ServersConfigSchema.parse(prodConfig);
                expect(result.analytics!.connectionMode).toBe('strict');
                expect(result.monitoring!.connectionMode).toBe('strict');
            });
        });
    });

    describe('Type Safety', () => {
        it('should maintain proper type inference for stdio config', () => {
            const config = {
                type: 'stdio' as const,
                command: 'node',
                args: ['server.js'],
            };

            const result = StdioServerConfigSchema.parse(config);

            // TypeScript should infer correct types
            expect(typeof result.type).toBe('string');
            expect(typeof result.command).toBe('string');
            expect(Array.isArray(result.args)).toBe(true);
            expect(typeof result.env).toBe('object');
        });

        it('should maintain proper type inference for server configs', () => {
            const configs = {
                server1: {
                    type: 'stdio' as const,
                    command: 'node',
                },
                server2: {
                    type: 'sse' as const,
                    url: 'http://localhost:8080/events',
                },
            };

            const result = ServersConfigSchema.parse(configs);

            // Should preserve discriminated union types
            expect(result.server1!.type).toBe('stdio');
            expect(result.server2!.type).toBe('sse');
        });
    });
});
