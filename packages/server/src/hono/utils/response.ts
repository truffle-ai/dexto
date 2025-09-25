import type { Context } from 'hono';
import { redactSensitiveData } from '@dexto/core';

type SendJsonOptions = {
    /**
     * Force pretty-printing regardless of the incoming query param.
     */
    pretty?: boolean;
};

export function sendJson<T>(
    ctx: Context,
    data: T,
    status: number = 200,
    options: SendJsonOptions = {}
) {
    const prettyParam = ctx.req.query('pretty');
    const shouldPrettyFromQuery = prettyParam === 'true' || prettyParam === '1';
    const shouldPretty = options.pretty ?? shouldPrettyFromQuery;

    const redactionFlag = ctx.get('redactResponse');
    const shouldRedact = Boolean(redactionFlag);
    const payloadSource = shouldRedact ? redactSensitiveData(data) : data;

    if (!shouldPretty) {
        return ctx.json(payloadSource, status as any);
    }

    const payload = JSON.stringify(payloadSource, null, 2);

    return ctx.newResponse(payload, {
        status,
        headers: {
            'Content-Type': 'application/json',
        },
    });
}
