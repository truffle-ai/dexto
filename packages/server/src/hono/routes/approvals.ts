import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { DenialReason, ApprovalStatus, ApprovalError } from '@dexto/core';
import type { ApprovalCoordinator } from '../../approval/approval-coordinator.js';
import {
    ApiErrorResponseSchema,
    BadRequestErrorResponse,
    InternalErrorResponse,
    JsonObjectSchema,
} from '../schemas/responses.js';
import type { GetAgentFn, OpenAPIRouteSchema } from '../types.js';

const ApprovalBodySchema = z
    .object({
        status: z
            .enum([ApprovalStatus.APPROVED, ApprovalStatus.DENIED, ApprovalStatus.CANCELLED])
            .describe('The user decision'),
        formData: JsonObjectSchema.optional().describe(
            'Optional form data provided by the user (for elicitation)'
        ),
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

type ApprovalResponse = z.output<typeof ApprovalResponseSchema>;
type ApprovalData = {
    formData?: z.output<typeof JsonObjectSchema>;
    rememberChoice?: boolean;
    rememberPattern?: string;
    rememberDirectory?: boolean;
};

const PendingApprovalSchema = z
    .object({
        approvalId: z.string().describe('The unique ID of the approval request'),
        type: z.string().describe('The type of approval (tool_confirmation, elicitation, etc.)'),
        sessionId: z.string().optional().describe('The session ID if applicable'),
        timeout: z.number().optional().describe('Timeout in milliseconds'),
        timestamp: z.string().describe('ISO timestamp when the request was created'),
        metadata: JsonObjectSchema.describe('Type-specific metadata for the pending approval'),
    })
    .describe('A pending approval request');

const PendingApprovalsResponseSchema = z
    .object({
        ok: z.literal(true).describe('Success indicator'),
        approvals: z.array(PendingApprovalSchema).describe('List of pending approval requests'),
    })
    .describe('Response containing pending approval requests');

type PendingApprovalsResponse = z.output<typeof PendingApprovalsResponseSchema>;

const GetPendingApprovalsQuerySchema = z
    .object({
        sessionId: z.string().describe('The session ID to fetch pending approvals for'),
    })
    .describe('Query parameters for fetching pending approvals');

const ApprovalIdParamSchema = z
    .object({
        approvalId: z.string().describe('The ID of the approval request'),
    })
    .describe('Approval identifier params');

const ApprovalHeadersSchema = z
    .object({
        'Idempotency-Key': z
            .string()
            .optional()
            .describe('Optional key to ensure idempotent processing'),
    })
    .describe('Approval request headers');

const getPendingApprovalsRoute = createRoute({
    method: 'get',
    path: '/approvals',
    summary: 'Get Pending Approvals',
    description:
        'Fetch all pending approval requests for a session. Use this to restore UI state after page refresh.',
    tags: ['approvals'],
    request: {
        query: GetPendingApprovalsQuerySchema,
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
        400: BadRequestErrorResponse,
        500: InternalErrorResponse,
    },
});

const submitApprovalRoute = createRoute({
    method: 'post',
    path: '/approvals/{approvalId}',
    summary: 'Submit Approval Decision',
    description: 'Submit a user decision for a pending approval request',
    tags: ['approvals'],
    request: {
        params: ApprovalIdParamSchema,
        body: {
            content: { 'application/json': { schema: ApprovalBodySchema } },
        },
        headers: ApprovalHeadersSchema,
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
            description: 'Approval coordinator unavailable (server not initialized for approvals)',
            content: { 'application/json': { schema: ApprovalResponseSchema } },
        },
        500: {
            description: 'Approval processing failed',
            content: { 'application/json': { schema: ApprovalResponseSchema } },
        },
    },
});

// Mount subrouters through a tiny helper so declaration emit does not explode on
// repeated `app.openapi(...)` / `app.route(...)` generic expansion in this file.
// See: https://github.com/honojs/hono/issues/2399
function mountApprovalsSubrouter(app: OpenAPIHono, router: OpenAPIHono) {
    app.route('/', router);
}

export function createApprovalsRouter(
    getAgent: GetAgentFn,
    approvalCoordinator?: ApprovalCoordinator
): OpenAPIHono {
    const app = new OpenAPIHono();

    // TODO: Consider adding auth & idempotency for production deployments
    // See: https://github.com/truffle-ai/dexto/pull/450#discussion_r2545039760
    // - Auth: Open-source framework should allow flexible auth (reverse proxy, API gateway, etc.)
    // - Idempotency: Already documented in schema; platform can add tracking separately

    const getPendingApprovalsRouter = new OpenAPIHono();
    getPendingApprovalsRouter.openapi(getPendingApprovalsRoute, async (ctx) => {
        const agent = await getAgent(ctx);
        const { sessionId } = ctx.req.valid('query');

        agent.logger.debug(`Fetching pending approvals for session ${sessionId}`);

        const approvals = agent.services.approvalManager
            .getPendingApprovalRequests()
            .filter((approvalRequest) => approvalRequest.sessionId === sessionId)
            .map((approvalRequest) => ({
                approvalId: approvalRequest.approvalId,
                type: approvalRequest.type,
                sessionId: approvalRequest.sessionId,
                timeout: approvalRequest.timeout,
                timestamp: approvalRequest.timestamp.toISOString(),
                metadata: JsonObjectSchema.parse(approvalRequest.metadata),
            }));

        return ctx.json(
            {
                ok: true as const,
                approvals,
            } satisfies PendingApprovalsResponse,
            200
        );
    });

    const submitApprovalRouter = new OpenAPIHono();
    submitApprovalRouter.openapi(submitApprovalRoute, async (ctx) => {
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
            const response: ApprovalResponse = { ok: false, approvalId, status };
            return ctx.json(response, 503);
        }

        // Validate that the approval exists
        const pendingApprovals = agent.services.approvalManager.getPendingApprovals();
        if (!pendingApprovals.includes(approvalId)) {
            throw ApprovalError.notFound(approvalId);
        }

        try {
            // Build data object for approved requests
            const data: ApprovalData = {};
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
            // Get approval context from coordinator's mapping (stored when request was emitted)
            const sessionId = approvalCoordinator.getSessionId(approvalId);
            const hostRuntime = approvalCoordinator.getHostRuntime(approvalId);
            const responsePayload = {
                approvalId,
                status,
                sessionId, // Attach sessionId for SSE routing to correct client streams
                ...(hostRuntime !== undefined ? { hostRuntime } : {}),
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

            const response: ApprovalResponse = { ok: true, approvalId, status };
            return ctx.json(response, 200);
        } catch (error) {
            agent.logger.error('Error processing approval', { approvalId, error });
            const response: ApprovalResponse = { ok: false, approvalId, status };
            return ctx.json(response, 500);
        }
    });

    mountApprovalsSubrouter(app, getPendingApprovalsRouter);
    mountApprovalsSubrouter(app, submitApprovalRouter);

    return app;
}

type GetPendingApprovalsRouteSchema = OpenAPIRouteSchema<
    typeof getPendingApprovalsRoute,
    { query: z.input<typeof GetPendingApprovalsQuerySchema> }
>;

type SubmitApprovalRouteSchema = OpenAPIRouteSchema<
    typeof submitApprovalRoute,
    {
        param: z.input<typeof ApprovalIdParamSchema>;
        json: z.input<typeof ApprovalBodySchema>;
        header: z.input<typeof ApprovalHeadersSchema>;
    }
>;

export type ApprovalsRouterSchema = GetPendingApprovalsRouteSchema | SubmitApprovalRouteSchema;
