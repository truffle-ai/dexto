/** Discovery wire contract for the existing application-origin Cloud capabilities API. */
import { z } from 'zod';

const PaginationSchema = z
    .object({
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
    })
    .strict();
const SourceSchema = z
    .object({
        id: z.string(),
        kind: z.enum(['app', 'connection', 'llm', 'mcp', 'platform', 'skill', 'workspace']),
        title: z.string(),
        toolCount: z.number().int().nonnegative().optional(),
    })
    .passthrough();
const SourcesSchema = z.object({ sources: z.array(SourceSchema) }).passthrough();
const PathSchema = z.string().regex(/^[a-z0-9_.-]+\.[a-z0-9_.-]+$/u);
const ToolSchema = z
    .object({
        aliases: z.array(PathSchema),
        description: z.string(),
        execution: z.discriminatedUnion('mode', [
            z.object({ mode: z.literal('hosted'), owner: z.literal('cloud') }),
            z.object({ mode: z.literal('workspace'), owner: z.literal('runtime') }),
            z.object({ mode: z.literal('remote_mcp'), connectionId: z.string() }),
            z.object({ mode: z.literal('llm_gateway'), provider: z.literal('dexto-nova') }),
            z.object({ mode: z.literal('instruction_only') }),
        ]),
        invocable: z.discriminatedUnion('mode', [
            z.object({ mode: z.literal('available') }),
            z.object({ mode: z.literal('describe_only'), reason: z.string() }),
            z.object({ mode: z.literal('planned'), reason: z.string() }),
        ]),
        id: z.object({
            sourceId: z.string(),
            toolId: z.string(),
            resourceId: z.string().optional(),
            version: z.string().optional(),
        }),
        name: z.string(),
        sourceId: z.string(),
        tags: z.array(z.string()),
        inputSchema: z.unknown().optional(),
        outputSchema: z.unknown().optional(),
    })
    .passthrough();
const SearchInputSchema = PaginationSchema.extend({ query: z.string().trim().min(1) });
const SearchSchema = z
    .object({
        hasMore: z.boolean(),
        items: z.array(ToolSchema),
        nextOffset: z.number().int().nonnegative().nullable(),
        total: z.number().int().nonnegative(),
    })
    .passthrough();
const DescriptionSchema = ToolSchema.extend({
    examples: z.array(z.object({ input: z.unknown(), label: z.string() })).optional(),
    inputTypeScript: z.string().optional(),
    outputTypeScript: z.string().optional(),
    typeScriptDefinitions: z.record(z.string(), z.string()).optional(),
    usageNotes: z.array(z.string()).optional(),
});
const DescribeSchema = z.discriminatedUnion('found', [
    z.object({ found: z.literal(false), path: PathSchema }).passthrough(),
    z.object({ found: z.literal(true), tool: DescriptionSchema }).passthrough(),
]);

export type CloudPagination = z.input<typeof PaginationSchema>;
export type CloudSourcesResult = z.output<typeof SourcesSchema>;
export type CloudSearchInput = z.input<typeof SearchInputSchema>;
export type CloudSearchResult = z.output<typeof SearchSchema>;
export type CloudDescribeResult = z.output<typeof DescribeSchema>;
export interface DextoCloudClient {
    sources(input: CloudPagination): Promise<CloudSourcesResult>;
    search(input: CloudSearchInput): Promise<CloudSearchResult>;
    describe(path: string): Promise<CloudDescribeResult>;
}
export interface CloudClientConfig {
    origin: string;
    token: string;
    fetch: typeof globalThis.fetch;
}
export class CloudClientError extends Error {
    constructor(
        public readonly code:
            | 'http_error'
            | 'invalid_response'
            | 'configuration_error'
            | 'network_error',
        message: string,
        public readonly status?: number
    ) {
        super(message);
        this.name = 'CloudClientError';
    }
}

export function createDextoCloudClient(config: CloudClientConfig): DextoCloudClient {
    const origin = URL.canParse(config.origin) ? new URL(config.origin) : null;
    const isLoopback =
        origin !== null && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (
        origin === null ||
        origin.username ||
        origin.password ||
        origin.pathname !== '/' ||
        origin.search ||
        origin.hash ||
        (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && isLoopback))
    ) {
        throw new CloudClientError(
            'configuration_error',
            'Provide an HTTPS Cloud application origin (loopback HTTP is allowed for development).'
        );
    }
    const token = config.token.trim();
    if (!token)
        throw new CloudClientError('configuration_error', 'A Cloud credential is required.');
    const applicationOrigin = origin.origin;
    async function request<T>(
        route: string,
        schema: z.ZodType<T>,
        query: Record<string, string>,
        body?: unknown
    ): Promise<T> {
        const url = new URL(`/api/capabilities/${route}`, applicationOrigin);
        url.search = new URLSearchParams(query).toString();
        const response = await config
            .fetch(url, {
                method: body === undefined ? 'GET' : 'POST',
                headers: {
                    authorization: `Bearer ${token}`,
                    accept: 'application/json',
                    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                redirect: 'error',
                signal: AbortSignal.timeout(30_000),
            })
            .catch(() => {
                throw new CloudClientError(
                    'network_error',
                    'Could not reach Cloud discovery. Check the application origin and network connection.'
                );
            });
        if (!response.ok) {
            const message =
                response.status === 401
                    ? 'Cloud authentication failed. Run dexto login or supply a valid DEXTO_API_KEY.'
                    : response.status === 403
                      ? 'Cloud discovery requires an organization credential with capabilities:read and current membership.'
                      : `Cloud discovery request failed (HTTP ${response.status}).`;
            throw new CloudClientError('http_error', message, response.status);
        }
        const payload: unknown = await response.json().catch(() => undefined);
        const parsed = schema.safeParse(payload);
        if (!parsed.success)
            throw new CloudClientError(
                'invalid_response',
                'Cloud returned an incompatible discovery response.'
            );
        return parsed.data;
    }
    function paginationQuery(input: CloudPagination): Record<string, string> {
        return {
            ...(input.limit === undefined ? {} : { limit: String(input.limit) }),
            ...(input.offset === undefined ? {} : { offset: String(input.offset) }),
        };
    }
    return {
        sources(input) {
            return request(
                'sources',
                SourcesSchema,
                paginationQuery(PaginationSchema.parse(input))
            );
        },
        search(input) {
            const parsed = SearchInputSchema.parse(input);
            return request('search', SearchSchema, { ...paginationQuery(parsed), q: parsed.query });
        },
        describe(path) {
            return request('describe', DescribeSchema, {}, { path: PathSchema.parse(path) });
        },
    };
}
