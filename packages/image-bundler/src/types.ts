import type { ImageMetadata } from './image-definition/types.js';

export interface BundleOptions {
    /** Path to dexto.image.ts file */
    imagePath: string;
    /** Output directory for built image */
    outDir: string;
    /** Whether to generate source maps */
    sourcemap?: boolean;
    /** Whether to minify output */
    minify?: boolean;
}

export interface BundleResult {
    /** Path to generated entry file */
    entryFile: string;
    /** Path to generated types file */
    typesFile: string;
    /** Image metadata */
    metadata: ImageMetadata;
    /** Warnings encountered during build */
    warnings: string[];
}

export interface GeneratedCode {
    /** Generated JavaScript code */
    js: string;
    /** Generated TypeScript definitions */
    dts: string;
}
