import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { type DextoAgent, DenialReason, ApprovalStatus, ApprovalError } from '@dexto/core';
import type { ApprovalCoordinator } from '../../approval/approval-coordinator.js';

const ApprovalBodySchema = z
    .object({
        status: z
            .enum([ApprovalStatus.APPROVED, ApprovalStatus.DENIED])
            .describe('The user decision'),
        formData: z
            .record(z.unknown())
            .optional()
            .describe('Optional form data provided by the user (for elicitation)'),
        rememberChoice: z
            .boolean()
            .optional()
            .describe('Whether to remember this choice for future requests'),
    })
    .describe('Request body for submitting an approval decision');

const ApprovalResponseSchema = z
    .object({
        ok: z.boolean().describe('Whether the approval was successfully processed'),
        approvalId: z.string().describe('The ID of the processed approval'),
        status: z
            .enum([ApprovalStatus.APPROVED, ApprovalStatus.DENIED])
            .describe('The final status'),
    })
    .describe('Response after processing approval');

export function createApprovalsRouter(
    getAgent: () => DextoAgent,
    approvalCoordinator?: ApprovalCoordinator
) {
    const app = new OpenAPIHono();

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
            },
            400: {
                description: 'Validation error',
            },
        },
    });

    app.openapi(submitApprovalRoute, async (ctx) => {
        const agent = getAgent();
        const { approvalId } = ctx.req.valid('param');
        const { status, formData, rememberChoice } = ctx.req.valid('json');

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
            }

            // Construct response payload
            const responsePayload = {
                approvalId,
                status,
                sessionId: undefined, // ApprovalManager maps approvalId -> request internally
                ...(status === ApprovalStatus.DENIED
                    ? {
                          reason: DenialReason.USER_DENIED,
                          message: 'User denied the request via API',
                      }
                    : {}),
                ...(Object.keys(data).length > 0 ? { data } : {}),
            };

            // Emit via approval coordinator which ManualApprovalHandler listens to
            approvalCoordinator.emitResponse(responsePayload);

            return ctx.json({
                ok: true,
                approvalId,
                status,
            });
        } catch (error) {
            agent.logger.error('Error processing approval', { approvalId, error });
            return ctx.json({ ok: false as const, approvalId, status }, 500);
        }
    });

    return app;
}
