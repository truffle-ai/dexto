import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { type DextoAgent, DenialReason, ApprovalStatus, ApprovalError } from '@dexto/core';
import type { ApprovalCoordinator } from '../../approval/approval-coordinator.js';
import { ApiErrorResponseSchema } from '../schemas/responses.js';
import type { Context } from 'hono';
type GetAgentFn = (ctx: Context) => DextoAgent | Promise<DextoAgent>;

const ApprovalBodySchema = z
    .object({
        status: z
            .enum([ApprovalStatus.APPROVED, ApprovalStatus.DENIED, ApprovalStatus.CANCELLED])
            .describe('The user decision'),
        formData: z
            .record(z.unknown())
            .optional()
            .describe('Optional form data provided by the user (for elicitation)'),
        rememberChoice: z
            .boolean()
            .optional()
            .describe('Whether to remember this choice for future requests'),
        rememberPattern: z
            .string()
            .optional()
            .describe('Optional approval pattern to remember for future requests'),
        rememberDirectory: z
            .boolean()
            .optional()
            .describe('Whether to remember the approved directory for future requests'),
        reason: z
            .nativeEnum(DenialReason)
            .optional()
            .describe('Optional structured denial or cancellation reason'),
        message: z.string().optional().describe('Optional freeform denial or cancellation message'),
    })
    .strict()
    .superRefine((value, refinementCtx) => {
        const addFieldIssue = (path: string, message: string) => {
            refinementCtx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [path],
                message,
            });
        };

        if (value.status === ApprovalStatus.APPROVED) {
            if (value.reason !== undefined) {
                addFieldIssue(
                    'reason',
                    'reason is only allowed when status is denied or cancelled'
                );
            }
            if (value.message !== undefined) {
                addFieldIssue(
                    'message',
                    'message is only allowed when status is denied or cancelled'
                );
            }
            return;
        }

        if (value.formData !== undefined) {
            addFieldIssue('formData', 'formData is only allowed when status is approved');
        }
        if (value.rememberChoice !== undefined) {
            addFieldIssue(
                'rememberChoice',
                'rememberChoice is only allowed when status is approved'
            );
        }
        if (value.rememberPattern !== undefined) {
            addFieldIssue(
                'rememberPattern',
                'rememberPattern is only allowed when status is approved'
            );
        }
        if (value.rememberDirectory !== undefined) {
            addFieldIssue(
                'rememberDirectory',
                'rememberDirectory is only allowed when status is approved'
            );
        }

        if (value.reason === undefined) {
            return;
        }

        if (value.status === ApprovalStatus.DENIED) {
            const invalidReasons = new Set<DenialReason>([
                DenialReason.USER_CANCELLED,
                DenialReason.SYSTEM_CANCELLED,
                DenialReason.TIMEOUT,
            ]);
            if (invalidReasons.has(value.reason)) {
                addFieldIssue('reason', 'reason must describe a denial when status is denied');
            }
            return;
        }

        const invalidReasons = new Set<DenialReason>([
            DenialReason.USER_DENIED,
            DenialReason.SYSTEM_DENIED,
            DenialReason.VALIDATION_FAILED,
            DenialReason.ELICITATION_DISABLED,
        ]);
        if (invalidReasons.has(value.reason)) {
            addFieldIssue('reason', 'reason must describe a cancellation when status is cancelled');
        }
    })
    .describe('Request body for submitting an approval decision');

const ApprovalResponseSchema = z
    .object({
        ok: z.boolean().describe('Whether the approval was successfully processed'),
        approvalId: z.string().describe('The ID of the processed approval'),
        status: z
            .enum([ApprovalStatus.APPROVED, ApprovalStatus.DENIED, ApprovalStatus.CANCELLED])
            .describe('The final status'),
    })
    .describe('Response after processing approval');

const PendingApprovalSchema = z
    .object({
        approvalId: z.string().describe('The unique ID of the approval request'),
        type: z.string().describe('The type of approval (tool_confirmation, elicitation, etc.)'),
        sessionId: z.string().optional().describe('The session ID if applicable'),
        timeout: z.number().optional().describe('Timeout in milliseconds'),
        timestamp: z.string().describe('ISO timestamp when the request was created'),
        metadata: z.record(z.unknown()).describe('Type-specific metadata'),
    })
    .describe('A pending approval request');

const PendingApprovalsResponseSchema = z
    .object({
        ok: z.literal(true).describe('Success indicator'),
        approvals: z.array(PendingApprovalSchema).describe('List of pending approval requests'),
    })
    .describe('Response containing pending approval requests');

export function createApprovalsRouter(
    getAgent: GetAgentFn,
    approvalCoordinator?: ApprovalCoordinator
) {
    const app = new OpenAPIHono();

    // GET /approvals - Fetch pending approval requests
    // Useful for restoring UI state after page refresh
    const getPendingApprovalsRoute = createRoute({
        method: 'get',
        path: '/approvals',
        summary: 'Get Pending Approvals',
        description:
            'Fetch all pending approval requests for a session. Use this to restore UI state after page refresh.',
        tags: ['approvals'],
        request: {
            query: z.object({
                sessionId: z.string().describe('The session ID to fetch pending approvals for'),
            }),
        },
        responses: {
            200: {
                description: 'List of pending approval requests',
                content: {
                    'application/json': {
                        schema: PendingApprovalsResponseSchema,
                    },
                },
            },
        },
    });

    // TODO: Consider adding auth & idempotency for production deployments
    // See: https://github.com/truffle-ai/dexto/pull/450#discussion_r2545039760
    // - Auth: Open-source framework should allow flexible auth (reverse proxy, API gateway, etc.)
    // - Idempotency: Already documented in schema; platform can add tracking separately
    const submitApprovalRoute = createRoute({
        method: 'post',
        path: '/approvals/{approvalId}',
        summary: 'Submit Approval Decision',
        description: 'Submit a user decision for a pending approval request',
        tags: ['approvals'],
        request: {
            params: z.object({
                approvalId: z.string().describe('The ID of the approval request'),
            }),
            body: {
                content: { 'application/json': { schema: ApprovalBodySchema } },
            },
            headers: z.object({
                'Idempotency-Key': z
                    .string()
                    .optional()
                    .describe('Optional key to ensure idempotent processing'),
            }),
        },
        responses: {
            200: {
                description: 'Approval processed successfully',
                content: {
                    'application/json': {
                        schema: ApprovalResponseSchema,
                    },
                },
            },
            404: {
                description: 'Approval request not found or expired',
                content: { 'application/json': { schema: ApiErrorResponseSchema } },
            },
            400: {
                description: 'Validation error',
                content: { 'application/json': { schema: ApiErrorResponseSchema } },
            },
            503: {
                description:
                    'Approval coordinator unavailable (server not initialized for approvals)',
                content: { 'application/json': { schema: ApprovalResponseSchema } },
            },
            500: {
                description: 'Approval processing failed',
                content: { 'application/json': { schema: ApprovalResponseSchema } },
            },
        },
    });

    return app
        .openapi(getPendingApprovalsRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { sessionId } = ctx.req.valid('query');

            agent.logger.debug(`Fetching pending approvals for session ${sessionId}`);

            // Get all pending approval IDs from the approval manager
            const pendingIds = agent.services.approvalManager.getPendingApprovals();

            // For now, return basic approval info
            // Full metadata would require storing approval requests in the coordinator
            const approvals = pendingIds.map((approvalId: string) => ({
                approvalId,
                type: 'tool_confirmation', // Default type
                sessionId,
                timestamp: new Date().toISOString(),
                metadata: {},
            }));

            return ctx.json({
                ok: true as const,
                approvals,
            });
        })
        .openapi(submitApprovalRoute, async (ctx) => {
            const agent = await getAgent(ctx);
            const { approvalId } = ctx.req.valid('param');
            const {
                status,
                formData,
                rememberChoice,
                rememberPattern,
                rememberDirectory,
                reason,
                message,
            } = ctx.req.valid('json');

            agent.logger.info(`Received approval decision for ${approvalId}: ${status}`);

            if (!approvalCoordinator) {
                agent.logger.error('ApprovalCoordinator not available');
                return ctx.json({ ok: false as const, approvalId, status }, 503);
            }

            // Validate that the approval exists
            const pendingApprovals = agent.services.approvalManager.getPendingApprovals();
            if (!pendingApprovals.includes(approvalId)) {
                throw ApprovalError.notFound(approvalId);
            }

            try {
                // Build data object for approved requests
                const data: Record<string, unknown> = {};
                if (status === ApprovalStatus.APPROVED) {
                    if (formData !== undefined) {
                        data.formData = formData;
                    }
                    if (rememberChoice !== undefined) {
                        data.rememberChoice = rememberChoice;
                    }
                    if (rememberPattern !== undefined) {
                        data.rememberPattern = rememberPattern;
                    }
                    if (rememberDirectory !== undefined) {
                        data.rememberDirectory = rememberDirectory;
                    }
                }

                // Construct response payload
                // Get sessionId from coordinator's mapping (stored when request was emitted)
                const sessionId = approvalCoordinator.getSessionId(approvalId);
                const responsePayload = {
                    approvalId,
                    status,
                    sessionId, // Attach sessionId for SSE routing to correct client streams
                    ...(status === ApprovalStatus.DENIED
                        ? {
                              reason: reason ?? DenialReason.USER_DENIED,
                              message: message ?? 'User denied the request via API',
                          }
                        : status === ApprovalStatus.CANCELLED
                          ? {
                                reason: reason ?? DenialReason.USER_CANCELLED,
                                message: message ?? 'User cancelled the request via API',
                            }
                          : {}),
                    ...(Object.keys(data).length > 0 ? { data } : {}),
                };

                // Emit via approval coordinator which ManualApprovalHandler listens to
                approvalCoordinator.emitResponse(responsePayload);

                return ctx.json(
                    {
                        ok: true,
                        approvalId,
                        status,
                    },
                    200
                );
            } catch (error) {
                agent.logger.error('Error processing approval', { approvalId, error });
                return ctx.json({ ok: false as const, approvalId, status }, 500);
            }
        });
}
