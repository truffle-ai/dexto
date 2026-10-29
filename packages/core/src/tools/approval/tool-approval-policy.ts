import type { Tool, ToolApprovalDecision, ToolExecutionContext, ToolIdentity } from '../types.js';
import { ToolError } from '../errors.js';

/** Which check let a call run without asking: the first of the policy's checks that passed. */
export type ToolApprovalReadyReason =
    | ExplicitToolAllow
    | 'auto-approve-mode'
    | 'tool-allows'
    | 'session-approved-key';

/** Where an explicit allow came from: the session's list, the static list, or the host's provider. */
export type ExplicitToolAllow = 'session-allowed' | 'always-allow' | 'allowed-tools';

export type ToolApprovalGate =
    | {
          because: ToolApprovalReadyReason;
          kind: 'ready';
      }
    | {
          approvalKey?: string | undefined;
          kind: 'approval-required';
      };

type AuthoredToolApproval =
    | {
          kind: 'none';
      }
    | {
          kind: 'allow';
      }
    | {
          approvalKey?: string | undefined;
          kind: 'require';
      };

export type ToolApprovalPolicyInput = {
    args: Record<string, unknown>;
    getContext: () => ToolExecutionContext;
    identity: ToolIdentity;
    sessionId?: string | undefined;
    toolName: string;
};

export type ToolApprovalPolicyDeps = {
    getApprovalMode(): 'manual' | 'auto-approve';
    getLocalTool(toolName: string): Tool | undefined;
    isApprovalKeySessionApproved(input: {
        approvalKey: string;
        sessionId?: string | undefined;
    }): boolean;
    findExplicitToolAllow(input: {
        sessionId?: string | undefined;
        toolName: string;
    }): Promise<ExplicitToolAllow | null> | ExplicitToolAllow | null;
};

export class ToolApprovalPolicy {
    constructor(private readonly deps: ToolApprovalPolicyDeps) {}

    async resolve(input: ToolApprovalPolicyInput): Promise<ToolApprovalGate> {
        const explicitAllow = await this.deps.findExplicitToolAllow({
            ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
            toolName: input.toolName,
        });
        if (explicitAllow !== null) {
            return { because: explicitAllow, kind: 'ready' };
        }

        if (this.deps.getApprovalMode() === 'auto-approve') {
            return { because: 'auto-approve-mode', kind: 'ready' };
        }

        const authored = await this.resolveAuthoredPolicy(input);
        if (authored.kind === 'allow') {
            return { because: 'tool-allows', kind: 'ready' };
        }

        if (authored.kind === 'require') {
            if (
                authored.approvalKey !== undefined &&
                this.deps.isApprovalKeySessionApproved({
                    approvalKey: authored.approvalKey,
                    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
                })
            ) {
                return { because: 'session-approved-key', kind: 'ready' };
            }

            return {
                ...(authored.approvalKey !== undefined
                    ? { approvalKey: authored.approvalKey }
                    : {}),
                kind: 'approval-required',
            };
        }

        if (input.identity.type === 'mcp') {
            const approvalKey = `mcp:${encodeURIComponent(input.identity.connectionId)}:${encodeURIComponent(input.identity.toolName)}`;
            if (
                this.deps.isApprovalKeySessionApproved({
                    approvalKey,
                    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
                })
            ) {
                return { because: 'session-approved-key', kind: 'ready' };
            }
            return { approvalKey, kind: 'approval-required' };
        }

        return { kind: 'approval-required' };
    }

    private async resolveAuthoredPolicy(
        input: ToolApprovalPolicyInput
    ): Promise<AuthoredToolApproval> {
        if (input.identity.type !== 'local') {
            return { kind: 'none' };
        }

        const needsApproval = this.deps.getLocalTool(input.toolName)?.needsApproval;
        if (needsApproval === undefined) {
            return { kind: 'none' };
        }

        const decision: ToolApprovalDecision =
            typeof needsApproval === 'function'
                ? await needsApproval(input.args, this.getAuthoredPolicyContext(input))
                : needsApproval;

        if (decision === false || decision === null) {
            return { kind: 'allow' };
        }

        if (decision === true) {
            return { kind: 'require' };
        }

        return decision.length > 0 && decision.trim() === decision
            ? { approvalKey: decision, kind: 'require' }
            : { kind: 'require' };
    }

    private getAuthoredPolicyContext(input: ToolApprovalPolicyInput): ToolExecutionContext {
        const context = input.getContext();
        if (context.sessionId !== input.sessionId) {
            throw ToolError.configInvalid(
                `Tool '${input.toolName}' approval context session does not match the approval scope`
            );
        }
        return context;
    }
}
