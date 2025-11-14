/**
 * ESLint rule to prevent optional logger parameters in class constructors
 *
 * This rule enforces that logger parameters in class constructors must be required,
 * not optional. Logger is a critical dependency that should always be provided
 * for proper debugging and monitoring.
 *
 * @example
 * // Bad
 * class MyService {
 *   constructor(config: Config, logger?: IDextoLogger) {}
 * }
 *
 * // Good
 * class MyService {
 *   constructor(config: Config, logger: IDextoLogger) {}
 * }
 */

export default {
    meta: {
        type: 'problem',
        docs: {
            description: 'Disallow optional logger parameters in class constructors',
            category: 'Best Practices',
            recommended: true,
        },
        messages: {
            optionalLogger:
                'Logger parameter in constructor should be required, not optional. ' +
                'Remove the "?" to make it required: "logger: IDextoLogger"',
        },
        schema: [],
    },

    create(context) {
        return {
            // Check constructor methods in class declarations
            MethodDefinition(node) {
                // Only check constructors
                if (node.kind !== 'constructor') {
                    return;
                }

                // Check each parameter
                const params = node.value.params || [];
                for (const param of params) {
                    // Handle Identifier nodes (simple parameters)
                    if (param.type === 'Identifier') {
                        // Check if parameter is named 'logger' and is optional
                        if (param.name === 'logger' && param.optional === true) {
                            // Check if it has IDextoLogger type annotation
                            if (param.typeAnnotation) {
                                const typeAnnotation = context.sourceCode.getText(
                                    param.typeAnnotation
                                );
                                if (typeAnnotation.includes('IDextoLogger')) {
                                    context.report({
                                        node: param,
                                        messageId: 'optionalLogger',
                                    });
                                }
                            }
                        }
                    }
                }
            },
        };
    },
};
