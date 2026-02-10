import type { ImageDefinition } from './types.js';

/**
 * Validate a legacy image definition.
 * Throws if the definition is invalid.
 *
 * Used by bundler to validate images before building.
 */
export function validateImageDefinition(definition: ImageDefinition): void {
    // Basic validation
    if (!definition.name || typeof definition.name !== 'string') {
        throw new Error('Image name must be a non-empty string');
    }

    if (!definition.version || typeof definition.version !== 'string') {
        throw new Error('Image version must be a non-empty string');
    }

    if (!definition.description || typeof definition.description !== 'string') {
        throw new Error('Image description must be a non-empty string');
    }

    // Validate version format (basic semver check)
    const versionRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;
    if (!versionRegex.test(definition.version)) {
        throw new Error(
            `Image version '${definition.version}' is not valid semver. Expected format: x.y.z`
        );
    }

    // Validate target if provided
    const validTargets = [
        'local-development',
        'cloud-production',
        'edge-serverless',
        'embedded-iot',
        'enterprise',
        'custom',
    ];
    if (definition.target && !validTargets.includes(definition.target)) {
        throw new Error(
            `Invalid target '${definition.target}'. Valid targets: ${validTargets.join(', ')}`
        );
    }

    // Validate provider categories
    // Allow empty providers if extending a base image (providers inherited from base)
    const hasProviders =
        definition.providers &&
        Object.values(definition.providers).some((config) => config !== undefined);

    if (!hasProviders && !definition.extends) {
        throw new Error(
            'Image must either define at least one provider category or extend a base image'
        );
    }

    for (const [category, config] of Object.entries(definition.providers)) {
        if (!config) continue;

        if (!config.providers && !config.register) {
            throw new Error(
                `Provider category '${category}' must have either 'providers' array or 'register' function`
            );
        }

        if (config.providers && !Array.isArray(config.providers)) {
            throw new Error(`Provider category '${category}' providers must be an array`);
        }

        if (config.register && typeof config.register !== 'function') {
            throw new Error(`Provider category '${category}' register must be a function`);
        }
    }

    // Validate constraints if provided
    const validConstraints = [
        'filesystem-required',
        'network-required',
        'offline-capable',
        'serverless-compatible',
        'cold-start-optimized',
        'low-memory',
        'edge-compatible',
        'browser-compatible',
    ];

    if (definition.constraints) {
        if (!Array.isArray(definition.constraints)) {
            throw new Error('Image constraints must be an array');
        }

        for (const constraint of definition.constraints) {
            if (!validConstraints.includes(constraint)) {
                throw new Error(
                    `Invalid constraint '${constraint}'. Valid constraints: ${validConstraints.join(', ')}`
                );
            }
        }
    }

    // Validate utils if provided
    if (definition.utils) {
        for (const [name, path] of Object.entries(definition.utils)) {
            if (typeof path !== 'string') {
                throw new Error(`Utility '${name}' path must be a string`);
            }
            if (!path.startsWith('./')) {
                throw new Error(
                    `Utility '${name}' path must be relative (start with './'). Got: ${path}`
                );
            }
        }
    }

    // Validate extends if provided
    if (definition.extends) {
        if (typeof definition.extends !== 'string') {
            throw new Error('Image extends must be a string (parent image name)');
        }
    }
}
