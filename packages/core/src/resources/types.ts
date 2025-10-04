/**
 * Core resource types and interfaces for the ResourceManager
 */

import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Supported resource sources
 */
export type ResourceSource = 'mcp' | 'internal';

/**
 * Resource metadata information
 */
export interface ResourceMetadata {
    /** Unique URI/identifier for the resource */
    uri: string;
    /** Human-readable name for the resource */
    name?: string;
    /** Description of what this resource contains */
    description?: string;
    /** MIME type of the resource content */
    mimeType?: string;
    /** Source system that provides this resource */
    source: ResourceSource;
    /** Original server/provider name (for MCP resources) */
    serverName?: string;
    /** Size of the resource in bytes (if known) */
    size?: number;
    /** Last modified timestamp (ISO string or Date) */
    lastModified?: string | Date;
    /** Additional metadata specific to the resource type */
    metadata?: Record<string, unknown>;
}

/**
 * Resource provider interface - implemented by sources that can provide resources
 */
export interface ResourceProvider {
    /**
     * List all available resources from this provider
     */
    listResources(): Promise<ResourceMetadata[]>;

    /**
     * Read the content of a specific resource
     */
    readResource(uri: string): Promise<ReadResourceResult>;

    /**
     * Check if a resource exists
     */
    hasResource(uri: string): Promise<boolean>;

    /**
     * Get the source type of this provider
     */
    getSource(): ResourceSource;
}

/**
 * Resource set mapping URIs to resource metadata
 */
export type ResourceSet = Record<string, ResourceMetadata>;
