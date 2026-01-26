/**
 * Plugin Marketplace Zod Schemas
 */

import { z } from 'zod';

/**
 * Marketplace source specification
 */
export const MarketplaceSourceSchema = z
    .object({
        type: z.enum(['github', 'git', 'local']).describe('Type of marketplace source'),
        value: z.string().min(1).describe('Source value: owner/repo, git URL, or local path'),
    })
    .strict();

/**
 * Entry in the known marketplaces registry
 */
export const MarketplaceEntrySchema = z
    .object({
        name: z.string().min(1).describe('Unique name of the marketplace'),
        source: MarketplaceSourceSchema.describe('Source specification'),
        installLocation: z.string().describe('Local path where marketplace is installed'),
        lastUpdated: z.string().datetime().optional().describe('ISO timestamp of last update'),
    })
    .strict();

/**
 * Structure of known_marketplaces.json
 */
export const KnownMarketplacesFileSchema = z
    .object({
        version: z.number().default(1).describe('File format version'),
        marketplaces: z
            .record(MarketplaceEntrySchema)
            .default({})
            .describe('Registered marketplaces by name'),
    })
    .strict();

/**
 * Plugin entry in a marketplace manifest
 */
export const MarketplacePluginEntrySchema = z
    .object({
        name: z.string().min(1).describe('Plugin name'),
        description: z.string().optional().describe('Plugin description'),
        source: z.string().describe('Path to plugin within marketplace'),
        category: z.string().optional().describe('Plugin category'),
        version: z.string().optional().describe('Plugin version'),
    })
    .passthrough(); // Allow unknown fields for forward compatibility

/**
 * Marketplace manifest format (marketplace.json in repo root)
 * Compatible with Claude Code marketplace format
 */
export const MarketplaceManifestSchema = z
    .object({
        name: z.string().describe('Marketplace name'),
        version: z.string().optional().describe('Marketplace version'),
        owner: z
            .object({
                name: z.string(),
                email: z.string().optional(),
            })
            .optional()
            .describe('Owner information'),
        plugins: z.array(MarketplacePluginEntrySchema).optional().describe('Listed plugins'),
    })
    .passthrough(); // Allow unknown fields for forward compatibility

/**
 * CLI command schemas
 */
export const MarketplaceAddCommandSchema = z
    .object({
        source: z
            .string()
            .min(1)
            .describe('Marketplace source (owner/repo, git URL, or local path)'),
        name: z.string().optional().describe('Custom name for the marketplace'),
    })
    .strict();

export const MarketplaceInstallCommandSchema = z
    .object({
        plugin: z.string().min(1).describe('Plugin spec: name or name@marketplace'),
        scope: z.enum(['user', 'project', 'local']).default('user').describe('Installation scope'),
        force: z.boolean().default(false).describe('Force reinstall if already exists'),
    })
    .strict();
