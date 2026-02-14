/**
 * Schema Defaults Conventions:
 * – Field-level defaults live in the leaf schemas.
 * – AgentConfig decides if a section is optional by adding `.default({})`.
 *   It never duplicates per-field literal defaults.
 */

import { z } from 'zod';

// (agent card overrides are now represented as Partial<AgentCard> and processed via AgentCardSchema)

/**
 * Security Scheme Schemas (A2A Protocol, based on OpenAPI 3.0 Security Scheme Object)
 * Defines authentication mechanisms for the agent as a discriminated union
 */

const ApiKeySecurityScheme = z
    .object({
        type: z.literal('apiKey').describe('Security scheme type'),
        name: z.string().describe('Name of the header/query/cookie parameter'),
        in: z.enum(['query', 'header', 'cookie']).describe('Location of API key'),
        description: z.string().optional().describe('Description of the security scheme'),
    })
    .strict();

const HttpSecurityScheme = z
    .object({
        type: z.literal('http').describe('Security scheme type'),
        scheme: z.string().describe('HTTP authorization scheme (e.g., basic, bearer)'),
        bearerFormat: z.string().optional().describe('Hint for bearer token format'),
        description: z.string().optional().describe('Description of the security scheme'),
    })
    .strict();

const OAuth2FlowSchema = z
    .object({
        authorizationUrl: z.string().url().optional().describe('Authorization URL for the flow'),
        tokenUrl: z.string().url().optional().describe('Token URL for the flow'),
        refreshUrl: z.string().url().optional().describe('Refresh URL for the flow'),
        scopes: z.record(z.string()).describe('Available scopes for the OAuth2 flow'),
    })
    .strict();

const OAuth2SecurityScheme = z
    .object({
        type: z.literal('oauth2').describe('Security scheme type'),
        flows: z
            .object({
                implicit: OAuth2FlowSchema.optional(),
                password: OAuth2FlowSchema.optional(),
                clientCredentials: OAuth2FlowSchema.optional(),
                authorizationCode: OAuth2FlowSchema.optional(),
            })
            .strict()
            .describe('OAuth2 flow configurations'),
        description: z.string().optional().describe('Description of the security scheme'),
    })
    .strict();

const OpenIdConnectSecurityScheme = z
    .object({
        type: z.literal('openIdConnect').describe('Security scheme type'),
        openIdConnectUrl: z.string().url().describe('OpenID Connect discovery URL'),
        description: z.string().optional().describe('Description of the security scheme'),
    })
    .strict();

const MutualTLSSecurityScheme = z
    .object({
        type: z.literal('mutualTLS').describe('Security scheme type'),
        description: z.string().optional().describe('Description of the security scheme'),
    })
    .strict();

export const SecuritySchemeSchema = z.discriminatedUnion('type', [
    ApiKeySecurityScheme,
    HttpSecurityScheme,
    OAuth2SecurityScheme,
    OpenIdConnectSecurityScheme,
    MutualTLSSecurityScheme,
]);

/**
 * Agent Card Signature Schema (A2A Protocol v0.3.0)
 * JSON Web Signature for verifying AgentCard integrity
 */
const AgentCardSignatureSchema = z
    .object({
        protected: z.string().describe('Base64url-encoded JWS Protected Header'),
        signature: z.string().describe('Base64url-encoded JWS Signature'),
    })
    .strict();

/**
 * Dexto Extension Metadata Schema
 * Namespace for Dexto-specific extension fields
 */
const DextoMetadataSchema = z
    .object({
        authentication: z
            .object({
                schemes: z
                    .array(z.string())
                    .default([])
                    .describe('Legacy authentication schemes (deprecated: use securitySchemes)'),
                credentials: z.string().optional().describe('Credentials information'),
            })
            .strict()
            .optional()
            .describe('Legacy authentication configuration'),

        delegation: z
            .object({
                protocol: z
                    .enum(['dexto-v1', 'http-simple', 'a2a-jsonrpc', 'mcp-http'])
                    .describe('Delegation protocol version'),
                endpoint: z.string().describe('Delegation endpoint (relative path or full URL)'),
                supportsSession: z.boolean().describe('Whether agent supports stateful sessions'),
                supportsStreaming: z
                    .boolean()
                    .optional()
                    .describe('Whether agent supports streaming responses'),
            })
            .strict()
            .optional()
            .describe('Delegation protocol information for agent-to-agent communication'),

        owner: z
            .object({
                userId: z.string().describe('Unique user identifier from auth system'),
                username: z.string().describe('Display name'),
                email: z
                    .string()
                    .email()
                    .max(254)
                    .optional()
                    .describe(
                        'Optional user email (WARNING: publicly readable via .well-known/agent.json if provided)'
                    ),
            })
            .strict()
            .optional()
            .describe('Agent owner information (for multi-tenant deployments)'),
    })
    .strict();

/**
 * Agent Card Schema (A2A Protocol v0.3.0 Compliant)
 * Follows the A2A specification with extensions in the metadata field
 */
export const AgentCardSchema = z
    .object({
        // ────────────────────────────────────────────────────────
        // A2A Protocol Required Fields
        // ────────────────────────────────────────────────────────
        protocolVersion: z
            .string()
            .default('0.3.0')
            .describe('A2A protocol version (e.g., "0.3.0")'),

        name: z.string().describe('Human-readable agent name'),

        description: z.string().describe('Detailed description of agent purpose and capabilities'),

        url: z.string().url().describe('Primary endpoint URL for the agent'),

        version: z.string().describe('Agent version (semantic versioning recommended)'),

        preferredTransport: z
            .enum(['JSONRPC', 'GRPC', 'HTTP+JSON'])
            .default('JSONRPC')
            .describe('Primary transport protocol for communication'),

        defaultInputModes: z
            .array(z.string())
            .default(['application/json', 'text/plain'])
            .describe('Supported input MIME types'),

        defaultOutputModes: z
            .array(z.string())
            .default(['application/json', 'text/event-stream', 'text/plain'])
            .describe('Supported output MIME types'),

        skills: z
            .array(
                z
                    .object({
                        id: z.string().describe('Unique skill identifier'),
                        name: z.string().describe('Human-readable skill name'),
                        description: z.string().describe('Detailed skill description'),
                        tags: z.array(z.string()).describe('Searchable tags for discovery'),
                        examples: z
                            .array(z.string())
                            .optional()
                            .describe('Example use cases or queries'),
                        inputModes: z
                            .array(z.string())
                            .optional()
                            .default(['text/plain'])
                            .describe('Skill-specific input MIME types'),
                        outputModes: z
                            .array(z.string())
                            .optional()
                            .default(['text/plain'])
                            .describe('Skill-specific output MIME types'),
                    })
                    .strict()
            )
            .default([
                {
                    id: 'chat_with_agent',
                    name: 'chat_with_agent',
                    description: 'Allows you to chat with an AI agent. Send a message to interact.',
                    tags: ['chat', 'AI', 'assistant', 'mcp', 'natural language'],
                    examples: [
                        `Send a JSON-RPC request to /mcp with method: "chat_with_agent" and params: {"message":"Your query..."}`,
                        'Alternatively, use a compatible MCP client library.',
                    ],
                },
            ])
            .describe('Agent capabilities/skills'),

        // ────────────────────────────────────────────────────────
        // A2A Protocol Optional Fields
        // ────────────────────────────────────────────────────────
        provider: z
            .object({
                organization: z.string().describe('Provider organization name'),
                url: z.string().url().describe('Provider organization URL'),
            })
            .strict()
            .optional()
            .describe('Agent provider information'),

        iconUrl: z.string().url().optional().describe('URL to agent icon/logo (for UI display)'),

        documentationUrl: z.string().url().optional().describe('URL to agent documentation'),

        additionalInterfaces: z
            .array(
                z
                    .object({
                        url: z.string().url().describe('Endpoint URL'),
                        transport: z
                            .enum(['JSONRPC', 'GRPC', 'HTTP+JSON'])
                            .describe('Transport protocol'),
                    })
                    .strict()
            )
            .optional()
            .describe('Additional interfaces/transports supported by the agent'),

        capabilities: z
            .object({
                streaming: z
                    .boolean()
                    .optional()
                    .default(true)
                    .describe('Supports streaming responses'),
                pushNotifications: z.boolean().optional().describe('Supports push notifications'),
                stateTransitionHistory: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe('Provides state transition history'),
            })
            .strict()
            .default({})
            .describe('Agent capabilities and features'),

        securitySchemes: z
            .record(SecuritySchemeSchema)
            .optional()
            .describe('Map of security scheme definitions (A2A format)'),

        security: z
            .array(z.record(z.array(z.string())))
            .optional()
            .describe(
                'Security requirements (array of security scheme references with required scopes)'
            ),

        supportsAuthenticatedExtendedCard: z
            .boolean()
            .optional()
            .describe('Whether extended card is available with authentication'),

        signatures: z
            .array(AgentCardSignatureSchema)
            .optional()
            .describe('JSON Web Signatures for verifying AgentCard integrity'),

        metadata: z
            .object({
                dexto: DextoMetadataSchema.optional().describe('Dexto-specific extension metadata'),
            })
            .passthrough()
            .optional()
            .describe('Extension-specific metadata (namespaced by extension name)'),
    })
    .strict();
// Input type for user-facing API (pre-parsing)

export type AgentCard = z.input<typeof AgentCardSchema>;
// Validated type for internal use (post-parsing)
export type ValidatedAgentCard = z.output<typeof AgentCardSchema>;
