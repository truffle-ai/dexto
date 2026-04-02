import type { DextoAgent } from '@dexto/core';
import type { ApprovalCoordinator } from './approval-coordinator.js';

export function wireApprovalCoordinatorToAgent(
    agent: DextoAgent,
    approvalCoordinator: ApprovalCoordinator
): AbortController {
    const controller = new AbortController();
    const { signal } = controller;

    approvalCoordinator.onRequest(
        (request) => {
            agent.emit('approval:request', request);
        },
        { signal }
    );

    approvalCoordinator.onResponse(
        (response) => {
            agent.emit('approval:response', response);
        },
        { signal }
    );

    return controller;
}
