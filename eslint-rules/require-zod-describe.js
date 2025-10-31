/**
 * ESLint rule to enforce .describe() on all Zod schema methods
 *
 * This rule ensures that all Zod schema field definitions include a .describe() call
 * for better OpenAPI documentation generation.
 *
 * Catches patterns like:
 * - z.string().min(5)  ❌ Missing .describe()
 * - z.string().min(5).describe('...')  ✅ Correct
 * - z.object({ field: z.string() })  ❌ Field missing .describe()
 * - z.object({ field: z.string().describe('...') })  ✅ Correct
 */
export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Enforce .describe() on Zod schema methods for OpenAPI documentation',
            recommended: true,
        },
        fixable: null,
        schema: [
            {
                type: 'object',
                properties: {
                    exemptSchemaNames: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Schema variable names to exempt from this rule (e.g., test mocks)',
                    },
                },
                additionalProperties: false,
            },
        ],
        messages: {
            missingDescribe:
                'Zod schema field "{{field}}" is missing .describe() call. Add .describe("description here") for OpenAPI documentation.',
            missingDescribeChain:
                'Zod method chain is missing .describe() call. Add .describe("description here") for OpenAPI documentation.',
        },
    },

    create(context) {
        const options = context.options[0] || {};
        const exemptSchemaNames = new Set(options.exemptSchemaNames || []);

        // Zod primitive types that should have .describe()
        const zodPrimitiveTypes = new Set([
            'string',
            'number',
            'boolean',
            'date',
            'bigint',
            'null',
            'undefined',
            'any',
            'unknown',
            'never',
            'void',
            'literal',
            'enum',
            'nativeEnum',
        ]);

        // Zod method types that should have .describe()
        const zodMethodTypes = new Set([
            'array',
            'tuple',
            'record',
            'map',
            'set',
            'function',
            'lazy',
            'promise',
            'union',
            'discriminatedUnion',
            'intersection',
        ]);

        /**
         * Check if a node is a call to z.object()
         */
        function isZodObjectCall(node) {
            return (
                node.type === 'CallExpression' &&
                node.callee.type === 'MemberExpression' &&
                node.callee.object.name === 'z' &&
                node.callee.property.name === 'object'
            );
        }

        /**
         * Check if a node is a Zod primitive method call (e.g., z.string())
         */
        function isZodPrimitiveCall(node) {
            if (node.type !== 'CallExpression') return false;
            if (node.callee.type !== 'MemberExpression') return false;
            if (node.callee.object.name !== 'z') return false;
            return zodPrimitiveTypes.has(node.callee.property.name);
        }

        /**
         * Check if a node is a Zod method call (e.g., z.array())
         */
        function isZodMethodCall(node) {
            if (node.type !== 'CallExpression') return false;
            if (node.callee.type !== 'MemberExpression') return false;
            if (node.callee.object.name !== 'z') return false;
            return zodMethodTypes.has(node.callee.property.name);
        }

        /**
         * Check if a call chain has .describe() anywhere in the chain
         */
        function hasDescribeInChain(node) {
            let current = node;
            while (current) {
                if (
                    current.type === 'CallExpression' &&
                    current.callee.type === 'MemberExpression' &&
                    current.callee.property.name === 'describe'
                ) {
                    return true;
                }

                // Move up the chain
                if (current.type === 'CallExpression') {
                    current = current.callee.object;
                } else if (current.type === 'MemberExpression') {
                    current = current.object;
                } else {
                    break;
                }
            }
            return false;
        }

        /**
         * Check if a schema variable name is exempt
         */
        function isExemptSchema(node) {
            // Find the closest variable declaration
            let current = node;
            let depth = 0;
            const maxDepth = 10; // Prevent infinite loops

            while (current && depth < maxDepth) {
                if (current.type === 'VariableDeclarator' && current.id.type === 'Identifier') {
                    return exemptSchemaNames.has(current.id.name);
                }
                current = current.parent;
                depth++;
            }
            return false;
        }

        /**
         * Walk down a call/member chain to find the root Zod constructor call
         * For z.string().min(5), returns the z.string() node
         * For z.array(z.string()), returns the z.array() node
         */
        function findRootZodCall(node) {
            let current = node;

            while (current) {
                // Check if we found a root Zod call
                if (
                    isZodPrimitiveCall(current) ||
                    isZodMethodCall(current) ||
                    isZodObjectCall(current)
                ) {
                    return current;
                }

                // Walk down the chain
                if (current.type === 'CallExpression' && current.callee.type === 'MemberExpression') {
                    current = current.callee.object;
                    continue;
                }

                if (current.type === 'MemberExpression') {
                    current = current.object;
                    continue;
                }

                break;
            }

            return null;
        }

        return {
            // Check z.object({ field: z.string() }) patterns
            ObjectExpression(node) {
                // Check if this is inside a z.object() call
                const parent = node.parent;
                if (parent.type !== 'CallExpression') return;
                if (!isZodObjectCall(parent)) return;
                if (isExemptSchema(parent)) return;

                // Check each property in the object
                for (const property of node.properties) {
                    if (property.type !== 'Property') continue;
                    if (!property.value) continue;

                    const fieldName =
                        property.key.type === 'Identifier'
                            ? property.key.name
                            : property.key.type === 'Literal'
                              ? property.key.value
                              : '<unknown>';

                    // Check if the property value is a Zod call (walk the chain to find root)
                    const value = property.value;
                    const rootZodCall = findRootZodCall(value);
                    if (rootZodCall && !hasDescribeInChain(value)) {
                        context.report({
                            node: property,
                            messageId: 'missingDescribe',
                            data: { field: fieldName },
                        });
                    }
                }
            },

            // Check z.string(), z.array(), etc. at the top level of variable declarations
            VariableDeclarator(node) {
                if (!node.init) return;
                if (isExemptSchema(node)) return;

                // Only check if it's a schema definition (ends with "Schema" or "schema")
                if (node.id.type === 'Identifier') {
                    const varName = node.id.name;
                    if (!varName.endsWith('Schema') && !varName.endsWith('schema')) {
                        return;
                    }
                }

                // Use the same helper to find root Zod call
                const rootZodCall = findRootZodCall(node.init);
                if (rootZodCall && !hasDescribeInChain(node.init)) {
                    context.report({
                        node: node.init,
                        messageId: 'missingDescribeChain',
                    });
                }
            },
        };
    },
};
