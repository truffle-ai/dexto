// `cloud api`: call any /v1 operation with the sign-in, for what no command covers yet.

import { argument, BODY_OPTIONS, readJsonBody, UsageError, type Command } from '../command.js';
import { fetchV1, v1Failure } from '../v1.js';

const METHODS = new Set(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);

const api: Command = {
    arguments: '<method> <path>',
    options: BODY_OPTIONS,
    path: ['cloud', 'api'],
    summary: 'Call a /v1 path, such as: dexto cloud api GET /v1/agents. Prints the response body.',
    async run(context, input) {
        const method = argument(input, 0, 'method').toUpperCase();
        if (!METHODS.has(method)) throw new UsageError(`Unknown method ${method}.`);
        const body = await readJsonBody(context, input);
        const response = await fetchV1(
            context,
            method,
            argument(input, 1, 'path'),
            body === null ? null : JSON.stringify(body)
        );
        const text = await response.text();
        if (response.headers.get('content-type')?.includes('application/json') === true)
            context.runtime.writeOutput(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
        else
            context.runtime.writeOutput(
                text.endsWith('\n') || text.length === 0 ? text : `${text}\n`
            );
        if (!response.ok) throw v1Failure(context, response.status, text);
        return 0;
    },
};

export const apiCommands: readonly Command[] = [api];
