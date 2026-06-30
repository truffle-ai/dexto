import type { Tool, ToolApprovalDecision, ToolExecutionContext } from '../types.js';
import { ToolError } from '../errors.js';

export type ToolApprovalGate =
    | {
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
    sessionId?: string | undefined;
    source: 'local' | 'mcp';
    toolName: string;
};

export type ToolApprovalPolicyDeps = {
    getApprovalMode(): 'manual' | 'auto-approve';
    getLocalTool(toolName: string): Tool | undefined;
    isApprovalKeySessionApproved(input: {
        approvalKey: string;
        sessionId?: string | undefined;
    }): boolean;
    isToolExplicitlyAllowed(input: {
        sessionId?: string | undefined;
        toolName: string;
    }): Promise<boolean> | boolean;
};

export class ToolApprovalPolicy {
    constructor(private readonly deps: ToolApprovalPolicyDeps) {}

    async resolve(input: ToolApprovalPolicyInput): Promise<ToolApprovalGate> {
        if (
            await this.deps.isToolExplicitlyAllowed({
                ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
                toolName: input.toolName,
            })
        ) {
            return { kind: 'ready' };
        }

        if (this.deps.getApprovalMode() === 'auto-approve') {
            return { kind: 'ready' };
        }

        const authored = await this.resolveAuthoredPolicy(input);
        if (authored.kind === 'allow') {
            return { kind: 'ready' };
        }

        if (authored.kind === 'require') {
            if (
                authored.approvalKey !== undefined &&
                this.deps.isApprovalKeySessionApproved({
                    approvalKey: authored.approvalKey,
                    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
                })
            ) {
                return { kind: 'ready' };
            }

            return {
                ...(authored.approvalKey !== undefined
                    ? { approvalKey: authored.approvalKey }
                    : {}),
                kind: 'approval-required',
            };
        }

        return { kind: 'approval-required' };
    }

    private async resolveAuthoredPolicy(
        input: ToolApprovalPolicyInput
    ): Promise<AuthoredToolApproval> {
        if (input.source !== 'local') {
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
