import { z } from 'zod';

const ToolActivityPresentationSchema = z
    .object({
        category: z.string().min(1),
        label: z
            .object({
                running: z.string().min(1),
                completed: z.string().min(1),
            })
            .strict(),
        summary: z
            .object({
                verb: z.string().min(1),
                singular: z.string().min(1),
                plural: z.string().min(1),
            })
            .strict(),
    })
    .strict();

const PresentationValueSchema = z
    .object({
        label: z.string(),
        display: z.string(),
        kind: z.enum(['path', 'command', 'url', 'text', 'json']).optional(),
        sensitive: z.boolean().optional(),
    })
    .strict();

const UiEffectSchema = z.discriminatedUnion('type', [
    z
        .object({
            type: z.literal('setFlag'),
            flag: z.enum(['autoApproveEdits', 'planModeActive', 'planModeInitialized']),
            value: z.boolean(),
        })
        .strict(),
    z
        .object({
            type: z.literal('toast'),
            kind: z.enum(['info', 'warning', 'success', 'error']),
            message: z.string(),
        })
        .strict(),
]);

const ApprovalActionSchema = z.union([
    z
        .object({
            id: z.string(),
            label: z.string(),
            kind: z.enum(['primary', 'secondary', 'danger']).optional(),
            responseData: z.record(z.string(), z.unknown()).optional(),
            uiEffects: z.array(UiEffectSchema).optional(),
        })
        .strict(),
    z
        .object({
            id: z.string(),
            label: z.string(),
            kind: z.literal('danger').optional(),
            denyWithFeedback: z
                .object({
                    placeholder: z.string().optional(),
                    messageTemplate: z.string().optional(),
                })
                .strict(),
        })
        .strict(),
]);

/** Runtime validator for persisted and transported tool presentation snapshots. */
export const ToolPresentationSnapshotV1Schema = z
    .object({
        version: z.literal(1),
        activity: ToolActivityPresentationSchema.optional(),
        source: z
            .object({
                type: z.enum(['local', 'mcp']),
                mcpServerName: z.string().optional(),
            })
            .strict()
            .optional(),
        header: z
            .object({
                title: z.string().optional(),
                argsText: z.string().optional(),
            })
            .strict()
            .optional(),
        chips: z
            .array(
                z
                    .object({
                        kind: z.enum(['neutral', 'info', 'warning', 'danger', 'success']),
                        text: z.string(),
                    })
                    .strict()
            )
            .optional(),
        args: z
            .object({
                summary: z.array(PresentationValueSchema).optional(),
                groups: z
                    .array(
                        z
                            .object({
                                id: z.string(),
                                label: z.string(),
                                collapsedByDefault: z.boolean().optional(),
                                items: z.array(PresentationValueSchema),
                            })
                            .strict()
                    )
                    .optional(),
            })
            .strict()
            .optional(),
        capabilities: z.array(z.string()).optional(),
        approval: z
            .object({
                actions: z.array(ApprovalActionSchema).optional(),
            })
            .strict()
            .optional(),
        result: z
            .object({
                summaryText: z.string().optional(),
                uiEffects: z.array(UiEffectSchema).optional(),
            })
            .strict()
            .optional(),
    })
    .strict();

export type ToolPresentationSnapshotV1 = z.output<typeof ToolPresentationSnapshotV1Schema>;

export function isToolPresentationSnapshotV1(value: unknown): value is ToolPresentationSnapshotV1 {
    return ToolPresentationSnapshotV1Schema.safeParse(value).success;
}
