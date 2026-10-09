import type { SessionApproval } from '@dexto/core';

export function formatApprovalScope(approval: SessionApproval): string {
    if (approval.kind === 'tool') return `tool ${approval.value}`;
    if (approval.value.startsWith('bash:exact:')) {
        return `this exact command (${approval.value.slice(-8)})`;
    }
    if (approval.value.startsWith('bash:')) return approval.value.slice(5);
    return approval.value;
}
