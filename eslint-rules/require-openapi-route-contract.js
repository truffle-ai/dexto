const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

function isRouteFile(filename) {
    return filename.includes('/packages/server/src/hono/routes/');
}

function getMemberPropertyName(memberExpression) {
    if (memberExpression.property.type === 'Identifier' && !memberExpression.computed) {
        return memberExpression.property.name;
    }

    if (memberExpression.property.type === 'Literal') {
        return memberExpression.property.value;
    }

    return null;
}

export default {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Require OpenAPIHono + createRoute for server JSON route files so routes participate in docs and typed contracts',
            recommended: true,
        },
        schema: [],
        messages: {
            plainHono:
                'Server JSON route files must use OpenAPIHono + createRoute so routes appear in OpenAPI docs and typed clients. If this is a real transport/protocol/static exception, keep Hono and add an inline eslint-disable with a concrete reason.',
            directRouteMethod:
                'OpenAPIHono route files must register normal HTTP routes with createRoute(...) + app.openapi(...), not app.{{method}}(...). If this is a real transport/protocol/static exception, add an inline eslint-disable with a concrete reason.',
        },
    },

    create(context) {
        const filename = context.filename ?? context.getFilename();
        if (!isRouteFile(filename)) {
            return {};
        }

        const honoImports = new Set(['Hono']);
        const openApiHonoImports = new Set(['OpenAPIHono']);
        const honoAppKinds = new Map();

        function trackHonoConstruction(node, kind) {
            if (node.id?.type !== 'Identifier') {
                return;
            }
            honoAppKinds.set(node.id.name, kind);
        }

        return {
            ImportDeclaration(node) {
                if (node.source.value === 'hono') {
                    for (const specifier of node.specifiers) {
                        if (
                            specifier.type === 'ImportSpecifier' &&
                            specifier.imported.type === 'Identifier' &&
                            specifier.imported.name === 'Hono'
                        ) {
                            honoImports.add(specifier.local.name);
                        }
                    }
                }

                if (node.source.value === '@hono/zod-openapi') {
                    for (const specifier of node.specifiers) {
                        if (
                            specifier.type === 'ImportSpecifier' &&
                            specifier.imported.type === 'Identifier' &&
                            specifier.imported.name === 'OpenAPIHono'
                        ) {
                            openApiHonoImports.add(specifier.local.name);
                        }
                    }
                }
            },

            VariableDeclarator(node) {
                if (node.init?.type !== 'NewExpression' || node.init.callee.type !== 'Identifier') {
                    return;
                }

                const calleeName = node.init.callee.name;
                if (openApiHonoImports.has(calleeName)) {
                    trackHonoConstruction(node, 'openapi');
                    return;
                }

                if (honoImports.has(calleeName)) {
                    trackHonoConstruction(node, 'plain');
                    context.report({
                        node: node.init,
                        messageId: 'plainHono',
                    });
                }
            },

            CallExpression(node) {
                if (
                    node.callee.type !== 'MemberExpression' ||
                    node.callee.object.type !== 'Identifier'
                ) {
                    return;
                }

                const appKind = honoAppKinds.get(node.callee.object.name);
                if (appKind !== 'openapi') {
                    return;
                }

                const propertyName = getMemberPropertyName(node.callee);
                if (!ROUTE_METHODS.has(propertyName)) {
                    return;
                }

                context.report({
                    node: node.callee.property,
                    messageId: 'directRouteMethod',
                    data: { method: propertyName },
                });
            },
        };
    },
};
