import { z } from 'zod';

export default {
    metadata: {
        name: 'fixture-image',
        version: '0.0.0',
        description: 'fixture',
    },
    tools: {
        'noop-tools': {
            configSchema: z.object({ type: z.literal('noop-tools') }).passthrough(),
            create: () => [],
        },
    },
    storage: {
        blob: {
            'in-memory': {
                configSchema: z.any(),
                create: () => ({}),
            },
        },
        database: {
            'in-memory': {
                configSchema: z.any(),
                create: () => ({}),
            },
        },
        cache: {
            'in-memory': {
                configSchema: z.any(),
                create: () => ({}),
            },
        },
    },
    hooks: {
        noop: {
            configSchema: z.any(),
            create: () => ({}),
        },
    },
    compaction: {
        noop: {
            configSchema: z.any(),
            create: () => ({}),
        },
    },
    logger: {
        configSchema: z.object({}).passthrough(),
        create: () => ({}),
    },
};
