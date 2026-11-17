const SEPARATOR_ID = 'dexto:openrouter-thinking-block-separator';

export function isOpenRouterThinkingSeparator(value: unknown): boolean {
    return (
        isRecord(value) &&
        value.type === 'reasoning.summary' &&
        value.summary === '' &&
        (value.id === SEPARATOR_ID ||
            ((value.id === undefined || value.id === null) &&
                value.format === 'anthropic-claude-v1'))
    );
}

/** Keep distinct Anthropic thinking blocks apart in the OpenRouter SDK's stream accumulator. */
export function preserveOpenRouterThinkingBlocks(fetchImpl: typeof fetch): typeof fetch {
    return async (input, init) => {
        const response = await fetchImpl(input, init);
        if (
            !response.body ||
            !response.headers.get('content-type')?.includes('text/event-stream')
        ) {
            return response;
        }

        const lastDetails = new Map<number, { type: unknown; index: unknown }>();
        let pending = '';
        let boundaryEndedWithCR = false;
        const drain = (controller: { enqueue(chunk: string): void }) => {
            let boundary = /(?:\r\n|\n|\r(?!\n)){2}/.exec(pending);
            while (boundary) {
                const end = boundary.index + boundary[0].length;
                const frame = pending.slice(0, boundary.index);
                controller.enqueue(separateBlocks(frame, lastDetails) + boundary[0]);
                boundaryEndedWithCR = end === pending.length && boundary[0].endsWith('\r');
                pending = pending.slice(end);
                boundary = /(?:\r\n|\n|\r(?!\n)){2}/.exec(pending);
            }
        };
        const stream = response.body
            .pipeThrough(new globalThis.TextDecoderStream())
            .pipeThrough(
                new globalThis.TransformStream<string, string>({
                    transform(chunk, controller) {
                        if (!chunk) return;
                        // If a CRLF was split across chunks, forward the LF as part of the
                        // preceding boundary instead of treating it as a new blank line.
                        if (boundaryEndedWithCR && chunk.startsWith('\n')) {
                            controller.enqueue('\n');
                            chunk = chunk.slice(1);
                        }
                        boundaryEndedWithCR = false;
                        pending += chunk;
                        drain(controller);
                    },
                    flush(controller) {
                        drain(controller);
                        controller.enqueue(pending);
                    },
                })
            )
            .pipeThrough(new globalThis.TextEncoderStream());
        const headers = new globalThis.Headers(response.headers);
        headers.delete('content-length');
        return new Response(stream, {
            status: response.status,
            statusText: response.statusText,
            headers,
        });
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function separateBlocks(
    frame: string,
    lastDetails: Map<number, { type: unknown; index: unknown }>
) {
    const lines = frame.split(/\r\n|\n|\r/);
    const data = lines
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart());
    if (data.length === 0) return frame;

    let payload: unknown;
    try {
        payload = JSON.parse(data.join('\n'));
    } catch {
        return frame;
    }
    if (!isRecord(payload) || !Array.isArray(payload.choices)) return frame;

    let changed = false;
    for (const choice of payload.choices) {
        if (
            !isRecord(choice) ||
            !isRecord(choice.delta) ||
            !Array.isArray(choice.delta.reasoning_details)
        )
            continue;
        const choiceIndex = typeof choice.index === 'number' ? choice.index : 0;
        const details: unknown[] = [];
        for (const detail of choice.delta.reasoning_details) {
            if (!isRecord(detail)) {
                details.push(detail);
                continue;
            }
            const previous = lastDetails.get(choiceIndex);
            if (
                detail.type === 'reasoning.text' &&
                previous?.type === 'reasoning.text' &&
                typeof detail.index === 'number' &&
                typeof previous.index === 'number' &&
                detail.index !== previous.index
            ) {
                details.push({
                    type: 'reasoning.summary',
                    summary: '',
                    id: SEPARATOR_ID,
                    index: detail.index,
                });
                changed = true;
            }
            details.push(detail);
            lastDetails.set(choiceIndex, {
                type: detail.type,
                index:
                    detail.type === 'reasoning.text' && previous?.type === 'reasoning.text'
                        ? (detail.index ?? previous.index)
                        : detail.index,
            });
        }
        choice.delta.reasoning_details = details;
    }
    if (!changed) return frame;
    let wroteData = false;
    return lines
        .flatMap((line) => {
            if (!line.startsWith('data:')) return [line];
            if (wroteData) return [];
            wroteData = true;
            return [`data: ${JSON.stringify(payload)}`];
        })
        .join(frame.includes('\r\n') ? '\r\n' : frame.includes('\n') ? '\n' : '\r');
}
