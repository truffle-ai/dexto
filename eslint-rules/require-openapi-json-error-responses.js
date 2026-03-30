function isRouteFile(filename) {
    return filename.includes('/packages/server/src/hono/routes/');
}

function getPropertyName(property) {
    if (property.key.type === 'Identifier' && !property.computed) {
        return property.key.name;
    }

    if (property.key.type === 'Literal') {
        return String(property.key.value);
    }

    return null;
}

function getObjectProperty(node, name) {
    if (!node || node.type !== 'ObjectExpression') {
        return null;
    }

    for (const property of node.properties) {
        if (property.type !== 'Property') {
            continue;
        }

        if (getPropertyName(property) === name) {
            return property;
        }
    }

    return null;
}

function parseStatusCode(property) {
    const rawName = getPropertyName(property);
    if (!rawName) {
        return null;
    }

    const parsed = Number(rawName);
    if (!Number.isInteger(parsed)) {
        return null;
    }

    return parsed;
}

function hasJsonContent(responseObject) {
    const contentProperty = getObjectProperty(responseObject, 'content');
    if (!contentProperty || contentProperty.value.type !== 'ObjectExpression') {
        return false;
    }

    for (const contentEntry of contentProperty.value.properties) {
        if (contentEntry.type !== 'Property') {
            continue;
        }

        if (getPropertyName(contentEntry) === 'application/json') {
            return true;
        }
    }

    return false;
}

export default {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Require OpenAPI JSON routes to declare at least one JSON error response instead of success-only contracts',
            recommended: true,
        },
        schema: [],
        messages: {
            successOnlyJsonRoute:
                'OpenAPI JSON routes must declare at least one non-2xx JSON error response in createRoute(...responses...). Success-only JSON contracts hide real validation/runtime failures. Add explicit error responses like 400/404/409/500, or add an inline eslint-disable with a concrete reason if this route is intentionally success-only.',
        },
    },

    create(context) {
        const filename = context.filename ?? context.getFilename();
        if (!isRouteFile(filename)) {
            return {};
        }

        const createRouteImports = new Set(['createRoute']);

        return {
            ImportDeclaration(node) {
                if (node.source.value !== '@hono/zod-openapi') {
                    return;
                }

                for (const specifier of node.specifiers) {
                    if (
                        specifier.type === 'ImportSpecifier' &&
                        specifier.imported.type === 'Identifier' &&
                        specifier.imported.name === 'createRoute'
                    ) {
                        createRouteImports.add(specifier.local.name);
                    }
                }
            },

            CallExpression(node) {
                if (
                    node.callee.type !== 'Identifier' ||
                    !createRouteImports.has(node.callee.name) ||
                    node.arguments[0]?.type !== 'ObjectExpression'
                ) {
                    return;
                }

                const routeConfig = node.arguments[0];
                const responsesProperty = getObjectProperty(routeConfig, 'responses');
                if (!responsesProperty || responsesProperty.value.type !== 'ObjectExpression') {
                    return;
                }

                let hasJsonRoute = false;
                let hasJsonErrorResponse = false;

                for (const responseEntry of responsesProperty.value.properties) {
                    if (
                        responseEntry.type !== 'Property' ||
                        responseEntry.value.type !== 'ObjectExpression'
                    ) {
                        continue;
                    }

                    const statusCode = parseStatusCode(responseEntry);
                    if (statusCode === null) {
                        continue;
                    }

                    if (!hasJsonContent(responseEntry.value)) {
                        continue;
                    }

                    hasJsonRoute = true;

                    if (statusCode >= 400) {
                        hasJsonErrorResponse = true;
                        break;
                    }
                }

                if (!hasJsonRoute || hasJsonErrorResponse) {
                    return;
                }

                context.report({
                    node,
                    messageId: 'successOnlyJsonRoute',
                });
            },
        };
    },
};
