import { describe, expect, it } from 'vitest';
import type { DextoAgent } from '@dexto/core';
import { ApprovalStatus, DenialReason } from '@dexto/core';
import { createApprovalsRouter } from './approvals.js';

function createAgent(): DextoAgent {
    return {
        logger: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: () => {},
            getLevel: () => 'info',
            getLogFilePath: () => null,
        },
        services: {
            approvalManager: {
                getPendingApprovals: () => [],
            },
        },
    } as unknown as DextoAgent;
}

describe('createApprovalsRouter', () => {
    it('rejects approved payloads that include denial fields', async () => {
        const app = createApprovalsRouter(async () => createAgent());

        const response = await app.request('/approvals/apr_123', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                status: ApprovalStatus.APPROVED,
                reason: DenialReason.USER_DENIED,
            }),
        });

        expect(response.status).toBe(400);
    });

    it('rejects denied payloads that include approved-only fields', async () => {
        const app = createApprovalsRouter(async () => createAgent());

        const response = await app.request('/approvals/apr_123', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                status: ApprovalStatus.DENIED,
                rememberChoice: true,
            }),
        });

        expect(response.status).toBe(400);
    });

    it('rejects cancelled payloads with denial-only reasons and unknown fields', async () => {
        const app = createApprovalsRouter(async () => createAgent());

        const response = await app.request('/approvals/apr_123', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                status: ApprovalStatus.CANCELLED,
                reason: DenialReason.USER_DENIED,
                unexpected: true,
            }),
        });

        expect(response.status).toBe(400);
    });
});
