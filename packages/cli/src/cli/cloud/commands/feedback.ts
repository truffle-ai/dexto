// `feedback submit`: record a structured Dexto bug report as you, over the Dexto MCP's
// dexto_feedback_submit. The server validates the report and keeps its policy; the CLI reads the
// report, asks before sending it, and names the request so a retry can be matched to the first.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireConsent } from '../../interaction.js';
import {
    BODY_OPTIONS,
    flag,
    isJsonObject,
    readJsonBody,
    UsageError,
    YES_OPTION,
    type Command,
} from '../command.js';
import { requireLoginScopes } from './deploys.js';
import { queryWorkspaceTool, requestIdOption } from './workspace.js';

const TOOL = 'dexto_feedback_submit';

const ReceiptSchema = z
    .object({ createdAt: z.string(), recorded: z.literal(true), reportId: z.string() })
    .passthrough();

const EXAMPLE_REPORT = JSON.stringify({
    summary: 'Saving a profile name fails',
    actualBehavior: 'Save shows "Unable to save profile" and keeps the old name.',
    expectedBehavior: 'The new name is saved.',
    impact: 'People cannot change their public name.',
    reproduction: { kind: 'steps', steps: ['Open profile settings', 'Change the name', 'Save'] },
    diagnostics: [{ kind: 'page_url', value: '/settings/profile' }],
    relatedIdentifiers: [{ kind: 'trace', value: 'trace-456' }],
});

const submit: Command = {
    options: {
        ...BODY_OPTIONS,
        'request-id': {
            description:
                'Letters, digits, ".", "_" or "-" naming this report\'s request. The report records it, so a retry sent with the same id can be matched to the first. One is made when you leave it out, and printed.',
            type: 'string',
            valueName: 'ID',
        },
        'dry-run': { description: 'Show the call without sending it.', type: 'boolean' },
        ...YES_OPTION,
    },
    path: ['feedback', 'submit'],
    summary:
        'Report a Dexto bug as you, from a JSON report in --file (or - for stdin) or --data: summary, actualBehavior, expectedBehavior, impact and reproduction ({kind:"steps",steps} or {kind:"unavailable",reason}), with optional diagnostics and relatedIdentifiers ([{kind,value}]). Include only what helps fix it: no secrets, credentials, cookies, authorization headers, unneeded personal data, raw transcripts, long logs or base64.',
    examples: [
        'dexto feedback submit --file report.json --yes --json',
        `dexto feedback submit --data '${EXAMPLE_REPORT}' --dry-run --json`,
        'dexto feedback submit --file - --request-id "$REQUEST_ID" --yes --json < report.json',
    ],
    async run(context, input) {
        const report = await readJsonBody(context, input);
        if (report === null) throw new UsageError('Pass the report with --file or --data.');
        if (!isJsonObject(report)) throw new UsageError('The report must be a JSON object.');
        const requestId = requestIdOption(input, 'request-id') ?? randomUUID();
        if (flag(input, 'dry-run'))
            return context.output.result(
                { dryRun: true, tool: TOOL, requestId, arguments: report },
                `Would submit this report with request id ${requestId}.`
            );
        await requireLoginScopes(context, ['feedback:write']);
        await requireConsent(
            context,
            flag(input, 'yes'),
            'Submit this bug report to Dexto as you?'
        );
        // Said before the call, so a lost response can still be retried under the same id.
        context.output.note(`Request id: ${requestId}`);
        const receipt = ReceiptSchema.parse(
            await queryWorkspaceTool(context, TOOL, report, requestId)
        );
        context.output.result(
            { ...receipt, requestId },
            `Recorded report ${receipt.reportId} (request id ${requestId}).`
        );
    },
};

export const feedbackCommands: readonly Command[] = [submit];
