// Dexto's /v1 OpenAPI embeds each schema's shared definitions as JSON Schema `$defs` with refs like
// `#/$defs/__schema0`, which an OpenAPI document resolves from its root, where they don't exist.
// This hoists every local `$defs` entry into `components.schemas` (one per distinct definition)
// and points the refs there, so standard generators read it. Remove it once the served document
// is self-consistent (DEXTO-2033).

import { createHash } from 'node:crypto';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function normalizeOpenApi<Document extends { [key: string]: unknown }>(
    document: Document
): Document & { components: { schemas: Record<string, Json> } } {
    const copy = structuredClone(document) as { [key: string]: Json };
    const components = isObject(copy.components) ? copy.components : {};
    const schemas: { [key: string]: Json } = isObject(components.schemas) ? components.schemas : {};
    const hoisted = rewrite(copy.paths ?? null, new Map(), schemas);
    return {
        ...copy,
        paths: hoisted,
        components: { ...components, schemas },
    } as unknown as Document & { components: { schemas: Record<string, Json> } };
}

/** Rewrites a subtree: local defs in scope map to component names. */
function rewrite(node: Json, scope: Map<string, string>, schemas: { [key: string]: Json }): Json {
    if (Array.isArray(node)) return node.map((item) => rewrite(item, scope, schemas));
    if (!isObject(node)) return node;
    let inner = scope;
    if (isObject(node.$defs)) {
        inner = new Map(scope);
        const defs = node.$defs;
        // Names first, so defs that refer to each other (or themselves) resolve.
        for (const [local, definition] of Object.entries(defs))
            inner.set(local, `Def${digest(definition)}`);
        for (const [local, definition] of Object.entries(defs)) {
            const name = inner.get(local) ?? '';
            const rewritten = rewrite(definition, inner, schemas);
            // Generators write a self-referencing union (any JSON value) as a type TypeScript
            // rejects; it carries nothing a client checks, so it becomes unknown.
            schemas[name] ??= JSON.stringify(rewritten).includes(`"#/components/schemas/${name}"`)
                ? { description: 'Any JSON value.' }
                : rewritten;
        }
    }
    const out: { [key: string]: Json } = {};
    for (const [key, value] of Object.entries(node)) {
        if (key === '$defs' || key === '$schema') continue;
        if (key === '$ref' && typeof value === 'string' && value.startsWith('#/$defs/')) {
            const name = inner.get(value.slice('#/$defs/'.length));
            out[key] = name === undefined ? value : `#/components/schemas/${name}`;
            continue;
        }
        out[key] = rewrite(value, inner, schemas);
    }
    return out;
}

function digest(value: Json): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 10);
}

function isObject(value: unknown): value is { [key: string]: Json } {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
