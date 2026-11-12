/**
 * The `data` of an approved response, shaped for the approval's type. Core parses each type's
 * response with its own strict schema, so a tool approval can't carry `formData`, an elicitation
 * can't carry `rememberChoice`, and a command approval carries neither.
 */
import { ApprovalType, type ApprovalResponse } from '@dexto/core';

export interface ApprovedChoice {
    /** Remember this approval scope for the session. Tool approvals only. */
    rememberChoice?: boolean;
    /** The submitted form. Elicitations only. */
    formData?: Record<string, unknown>;
}

export function approvedResponseData(
    type: string,
    choice: ApprovedChoice
): ApprovalResponse['data'] {
    switch (type) {
        case ApprovalType.TOOL_APPROVAL:
            return choice.rememberChoice === undefined
                ? {}
                : { rememberChoice: choice.rememberChoice };
        case ApprovalType.ELICITATION:
            return { formData: choice.formData ?? {} };
        case ApprovalType.COMMAND_APPROVAL:
            return {};
        case ApprovalType.CUSTOM:
            return {
                ...(choice.rememberChoice === undefined
                    ? {}
                    : { rememberChoice: choice.rememberChoice }),
                ...(choice.formData === undefined ? {} : { formData: choice.formData }),
            };
        default:
            throw new Error(`Unknown approval type: ${type}`);
    }
}
