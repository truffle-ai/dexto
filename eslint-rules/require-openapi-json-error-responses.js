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

function unwrapExpression(node) {
    let current = node;

    while (
        current &&
        (current.type === 'TSAsExpression' ||
            current.type === 'TSSatisfiesExpression' ||
            current.type === 'TSNonNullExpression')
    ) {
        current = current.expression;
    }

    return current;
}

function getObjectProperty(node, name) {
    const unwrappedNode = unwrapExpression(node);
    if (!unwrappedNode || unwrappedNode.type !== 'ObjectExpression') {
        return null;
    }

    for (const property of unwrappedNode.properties) {
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

function isKnownJsonErrorResponse(node, objectLiterals) {
    const unwrappedNode = unwrapExpression(node);

    if (!unwrappedNode) {
        return false;
    }

    if (unwrappedNode.type === 'ObjectExpression') {
        return hasJsonContent(unwrappedNode);
    }

    if (unwrappedNode.type === 'Identifier') {
        const localObject = objectLiterals.get(unwrappedNode.name);
        if (localObject) {
            return isKnownJsonErrorResponse(localObject, objectLiterals);
        }

        return unwrappedNode.name.endsWith('ErrorResponse');
    }

    return false;
}

function collectResponseEntries(objectExpression, objectLiterals, seen = new Set()) {
    const unwrappedObject = unwrapExpression(objectExpression);
    if (!unwrappedObject || unwrappedObject.type !== 'ObjectExpression') {
        return [];
    }

    const entries = [];

    for (const property of unwrappedObject.properties) {
        if (property.type === 'Property') {
            entries.push(property);
            continue;
        }

        if (
            property.type === 'SpreadElement' &&
            property.argument.type === 'Identifier' &&
            !seen.has(property.argument.name)
        ) {
            const spreadObject = objectLiterals.get(property.argument.name);
            if (!spreadObject) {
                continue;
            }

            seen.add(property.argument.name);
            entries.push(...collectResponseEntries(spreadObject, objectLiterals, seen));
            seen.delete(property.argument.name);
        }
    }

    return entries;
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
        const objectLiterals = new Map();

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

            VariableDeclarator(node) {
                if (
                    node.parent.kind !== 'const' ||
                    node.id.type !== 'Identifier' ||
                    unwrapExpression(node.init)?.type !== 'ObjectExpression'
                ) {
                    return;
                }

                objectLiterals.set(node.id.name, unwrapExpression(node.init));
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

                for (const responseEntry of collectResponseEntries(
                    responsesProperty.value,
                    objectLiterals
                )) {
                    if (responseEntry.type !== 'Property') {
                        continue;
                    }

                    const statusCode = parseStatusCode(responseEntry);
                    if (statusCode === null) {
                        continue;
                    }

                    if (!isKnownJsonErrorResponse(responseEntry.value, objectLiterals)) {
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
