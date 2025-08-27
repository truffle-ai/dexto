import { z } from 'zod';

export const OtelConfigurationSchema = z.object({
    serviceName: z.string().optional(),
    enabled: z.boolean().optional(),
    tracerName: z.string().optional(),
    sampling: z
        .discriminatedUnion('type', [
            z.object({
                type: z.literal('ratio'),
                probability: z.number().min(0).max(1),
            }),
            z.object({
                type: z.literal('always_on'),
            }),
            z.object({
                type: z.literal('always_off'),
            }),
            z.object({
                type: z.literal('parent_based'),
                root: z.object({
                    probability: z.number().min(0).max(1),
                }),
            }),
        ])
        .optional(),
    disableLocalExport: z.boolean().optional(),
    export: z
        .union([
            z.object({
                type: z.literal('otlp'),
                protocol: z.enum(['grpc', 'http']).optional(),
                endpoint: z.string().url().optional(),
                headers: z.record(z.string()).optional(),
            }),
            z.object({
                type: z.literal('console'),
            }),
            z.object({
                type: z.literal('custom'),
                tracerName: z.string().optional(),
            }),
        ])
        .optional(),
});

export type OtelConfiguration = z.infer<typeof OtelConfigurationSchema>;
