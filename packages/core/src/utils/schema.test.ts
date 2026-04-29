import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Logger } from '../logger/v2/types.js';
import { convertZodSchemaToJsonSchema } from './schema.js';

function createMockLogger(): Logger {
    const logger: Logger = {
        debug: vi.fn(),
        silly: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        trackException: vi.fn(),
        createChild: vi.fn(() => logger),
        createFileOnlyChild: vi.fn(() => logger),
        setLevel: vi.fn(),
        getLevel: vi.fn(() => 'debug' as const),
        getLogFilePath: vi.fn(() => null),
        destroy: vi.fn(async () => undefined),
    };

    return logger;
}

describe('convertZodSchemaToJsonSchema', () => {
    it('emits defaulted optional fields in input mode so they stay optional', () => {
        const logger = createMockLogger();
        const schema = z
            .object({
                command: z.string(),
                timeout: z.number().int().positive().optional().default(120000),
                run_in_background: z.boolean().optional().default(false),
            })
            .strict();

        const jsonSchema = convertZodSchemaToJsonSchema(schema, logger);

        expect(jsonSchema.required).toEqual(['command']);
        expect(jsonSchema.properties).toMatchObject({
            command: { type: 'string' },
            timeout: { type: 'integer', default: 120000 },
            run_in_background: { type: 'boolean', default: false },
        });
    });
});
