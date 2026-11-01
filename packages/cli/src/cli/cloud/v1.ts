// Calls the public /v1 API as the sign-in, for `cloud api` and what the typed client does not cover.
import {
    CommandFailure,
    isJsonObject,
    signInCommand,
    UsageError,
    type CommandContext,
    type SignInContext,
} from './command.js';

/**
 * Sends one request to a `/v1` path with the sign-in's credential and Cloud project. The path is
 * resolved against the API and checked, so no path can send the credential elsewhere.
 */
export async function fetchV1(
    context: CommandContext,
    method: string,
    requestPath: string,
    body: string | null
): Promise<Response> {
    return await sendV1(
        context,
        method,
        requestPath,
        body === null ? null : { body, headers: { 'content-type': 'application/json' } }
    );
}

/** Sends bytes, such as a file, to a `/v1` path, with the headers that describe them. */
export async function sendV1(
    context: CommandContext,
    method: string,
    requestPath: string,
    content: {
        readonly body: string | globalThis.Blob;
        readonly headers: Readonly<Record<string, string>>;
    } | null
): Promise<Response> {
    const connection = await context.connection();
    const apiOrigin = new URL(connection.apiBaseUrl).origin;
    const url = new URL(requestPath, `${connection.apiBaseUrl}/`);
    if (
        !requestPath.startsWith('/v1/') ||
        url.origin !== apiOrigin ||
        !url.pathname.startsWith('/v1/')
    )
        throw new UsageError('The path must start with /v1/; the CLI only calls the public API.');
    return await context.runtime.fetch(url, {
        headers: {
            ...content?.headers,
            authorization: `Bearer ${connection.token}`,
            ...(connection.kind === 'oauth' && connection.cloudProject !== null
                ? { 'dexto-cloud-project': connection.cloudProject }
                : {}),
        },
        method,
        ...(content === null ? {} : { body: content.body }),
        signal: context.runtime.signal,
    });
}

/** As `fetchV1`, returning the JSON body of a success and failing with the error's kind otherwise. */
export async function callV1(
    context: CommandContext,
    method: string,
    requestPath: string,
    body: string | null
): Promise<unknown> {
    const response = await fetchV1(context, method, requestPath, body);
    const text = await response.text();
    if (!response.ok) throw v1Failure(context, response.status, text);
    return JSON.parse(text);
}

/** A failed call as the contract's failure, by its status and the error's message. */
export function v1Failure(context: SignInContext, status: number, text: string): CommandFailure {
    let message = `HTTP ${status}`;
    try {
        const body: unknown = JSON.parse(text);
        if (
            isJsonObject(body) &&
            isJsonObject(body.error) &&
            typeof body.error.message === 'string'
        )
            message = `HTTP ${status}: ${body.error.message}`;
    } catch {
        // Not JSON: the status says enough.
    }
    if (status === 401)
        return new CommandFailure('needs_sign_in', message, signInCommand(context, null));
    return new CommandFailure(
        status === 403
            ? 'needs_permission'
            : status === 404
              ? 'not_found'
              : status === 400 || status === 413 || status === 422
                ? 'invalid_input'
                : 'failed',
        message,
        null
    );
}
