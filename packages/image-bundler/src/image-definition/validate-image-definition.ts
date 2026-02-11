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
    if (definition.target !== undefined) {
        if (typeof definition.target !== 'string' || definition.target.trim().length === 0) {
            throw new Error(`Image target must be a non-empty string when provided`);
        }
    }

    if (definition.constraints) {
        if (!Array.isArray(definition.constraints)) {
            throw new Error('Image constraints must be an array');
        }

        for (const constraint of definition.constraints) {
            if (typeof constraint !== 'string' || constraint.trim().length === 0) {
                throw new Error(`Image constraint must be a non-empty string`);
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
