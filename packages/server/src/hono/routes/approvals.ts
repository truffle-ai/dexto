import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { type DextoAgent, DenialReason, ApprovalStatus } from '@dexto/core';
import type { MessageStreamManager } from '../../streams/message-stream-manager.js';

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
    messageStreamManager?: MessageStreamManager
) {
    const app = new OpenAPIHono();

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

        try {
            // Construct payload for event bus
            const responsePayload = {
                approvalId,
                status,
                // Note: sessionId is not passed by client in body, but needed by ApprovalManager?
                // Actually ApprovalManager maps approvalId -> request, so it knows the session.
                // However, the event bus might need sessionId to route if using SessionEventBus?
                // But here we emit to agent.agentEventBus.
                sessionId: undefined,
                ...(status === ApprovalStatus.DENIED
                    ? {
                          reason: DenialReason.USER_DENIED,
                          message: 'User denied the request via API',
                      }
                    : {}),
                ...(status === ApprovalStatus.APPROVED && formData ? { data: { formData } } : {}),
                ...(status === ApprovalStatus.APPROVED && rememberChoice !== undefined
                    ? { data: { rememberChoice } }
                    : {}),
            };

            // Emit to agent's event bus which ApprovalManager listens to
            agent.agentEventBus.emit('approval:response', responsePayload);

            return ctx.json({
                ok: true,
                approvalId,
                status,
            });
        } catch (error) {
            agent.logger.error(`Error processing approval ${approvalId}: ${error}`);
            // Return 500 via context
            return ctx.json({ ok: false, approvalId, status } as any, 500);
        }
    });

    return app;
}
