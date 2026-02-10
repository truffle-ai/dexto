import type { DextoImageModule } from '../image/types.js';

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSchemaLike(value: unknown): boolean {
    return isPlainObject(value) && typeof value.parse === 'function';
}

function assertFactoryMap(
    value: unknown,
    options: { imageName: string; field: string }
): asserts value is Record<string, { configSchema: unknown; create: unknown }> {
    const { imageName, field } = options;

    if (!isPlainObject(value)) {
        throw new Error(`Invalid image '${imageName}': expected '${field}' to be an object`);
    }

    for (const [key, factory] of Object.entries(value)) {
        if (!isPlainObject(factory)) {
            throw new Error(
                `Invalid image '${imageName}': expected '${field}.${key}' to be an object`
            );
        }
        if (!isSchemaLike(factory.configSchema)) {
            throw new Error(
                `Invalid image '${imageName}': expected '${field}.${key}.configSchema' to be a Zod schema`
            );
        }
        if (typeof factory.create !== 'function') {
            throw new Error(
                `Invalid image '${imageName}': expected '${field}.${key}.create' to be a function`
            );
        }
    }
}

function assertDextoImageModule(
    value: unknown,
    imageName: string
): asserts value is DextoImageModule {
    if (!isPlainObject(value)) {
        throw new Error(`Invalid image '${imageName}': expected an object export`);
    }

    const metadata = value.metadata;
    if (!isPlainObject(metadata)) {
        throw new Error(`Invalid image '${imageName}': missing required 'metadata' object`);
    }
    if (typeof metadata.name !== 'string' || metadata.name.length === 0) {
        throw new Error(`Invalid image '${imageName}': metadata.name must be a non-empty string`);
    }
    if (typeof metadata.version !== 'string' || metadata.version.length === 0) {
        throw new Error(
            `Invalid image '${imageName}': metadata.version must be a non-empty string`
        );
    }
    if (typeof metadata.description !== 'string' || metadata.description.length === 0) {
        throw new Error(
            `Invalid image '${imageName}': metadata.description must be a non-empty string`
        );
    }
    if (metadata.target !== undefined && typeof metadata.target !== 'string') {
        throw new Error(
            `Invalid image '${imageName}': metadata.target must be a string when provided`
        );
    }
    if (metadata.constraints !== undefined) {
        if (
            !Array.isArray(metadata.constraints) ||
            metadata.constraints.some((c) => typeof c !== 'string')
        ) {
            throw new Error(
                `Invalid image '${imageName}': metadata.constraints must be string[] when provided`
            );
        }
    }

    assertFactoryMap(value.tools, { imageName, field: 'tools' });

    const storage = value.storage;
    if (!isPlainObject(storage)) {
        throw new Error(`Invalid image '${imageName}': missing required 'storage' object`);
    }
    assertFactoryMap(storage.blob, { imageName, field: 'storage.blob' });
    assertFactoryMap(storage.database, { imageName, field: 'storage.database' });
    assertFactoryMap(storage.cache, { imageName, field: 'storage.cache' });

    assertFactoryMap(value.plugins, { imageName, field: 'plugins' });
    assertFactoryMap(value.compaction, { imageName, field: 'compaction' });

    const logger = value.logger;
    if (!isPlainObject(logger)) {
        throw new Error(`Invalid image '${imageName}': missing required 'logger' factory`);
    }
    if (!isSchemaLike(logger.configSchema)) {
        throw new Error(`Invalid image '${imageName}': logger.configSchema must be a Zod schema`);
    }
    if (typeof logger.create !== 'function') {
        throw new Error(`Invalid image '${imageName}': logger.create must be a function`);
    }
}

function extractImageExport(module: unknown): unknown {
    if (!isPlainObject(module)) {
        return module;
    }

    if ('default' in module && module.default !== undefined) {
        return module.default;
    }

    if ('image' in module && module.image !== undefined) {
        return module.image;
    }

    return module;
}

export async function loadImage(imageName: string): Promise<DextoImageModule> {
    let module: unknown;
    try {
        module = await import(imageName);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to import image '${imageName}': ${message}`);
    }

    const candidate = extractImageExport(module);
    assertDextoImageModule(candidate, imageName);
    return candidate;
}
