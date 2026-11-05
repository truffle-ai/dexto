import { describe, expect, it } from 'vitest';
import {
    ApprovalStatus,
    ApprovalType,
    CommandApprovalResponseSchema,
    CustomApprovalResponseSchema,
    ElicitationResponseSchema,
    ToolApprovalResponseSchema,
} from '@dexto/core';
import { approvedResponseData, type ApprovedChoice } from './approval-response.js';
import type { ApprovalOptions } from '../components/ApprovalPrompt.js';

// The schema core's ApprovalManager parses each type's response with. A new approval type
// fails to compile here until it has one.
const responseSchemaFor = {
    [ApprovalType.TOOL_APPROVAL]: ToolApprovalResponseSchema,
    [ApprovalType.COMMAND_APPROVAL]: CommandApprovalResponseSchema,
    [ApprovalType.ELICITATION]: ElicitationResponseSchema,
    [ApprovalType.CUSTOM]: CustomApprovalResponseSchema,
} satisfies Record<ApprovalType, unknown>;

// Every options object the approval prompt passes to onApprove.
const promptChoices: Record<string, ApprovalOptions> = {
    'allow once': {},
    'allow for this session': { rememberChoice: true },
    'accept all edits': { enableAcceptEditsMode: true },
    'submitted form': { formData: { name: 'dexto' } },
};

function approvedResponse(type: ApprovalType, choice: ApprovedChoice) {
    return {
        approvalId: '6876ad89-66df-4475-8aa6-42f184979342',
        status: ApprovalStatus.APPROVED,
        sessionId: 'session-1',
        data: approvedResponseData(type, choice),
    };
}

describe('approvedResponseData', () => {
    for (const type of Object.values(ApprovalType)) {
        for (const [name, choice] of Object.entries(promptChoices)) {
            it(`passes core's ${type} response schema for "${name}"`, () => {
                const result = responseSchemaFor[type].safeParse(approvedResponse(type, choice));
                expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
            });
        }
    }

    it('keeps "allow for this session" on a tool approval', () => {
        const parsed = ToolApprovalResponseSchema.parse(
            approvedResponse(ApprovalType.TOOL_APPROVAL, { rememberChoice: true })
        );
        expect(parsed.data).toEqual({ rememberChoice: true });
    });

    it('keeps the submitted form on an elicitation', () => {
        const parsed = ElicitationResponseSchema.parse(
            approvedResponse(ApprovalType.ELICITATION, { formData: { name: 'dexto' } })
        );
        expect(parsed.data).toEqual({ formData: { name: 'dexto' } });
    });

    it('rejects a type core does not have', () => {
        expect(() => approvedResponseData('not-a-type', {})).toThrow('Unknown approval type');
    });
});
