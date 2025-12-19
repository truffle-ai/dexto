/**
 * Four Ways to Work with Dexto Images
 *
 * This file demonstrates the four supported patterns for working with Dexto.
 * Choose the pattern that best fits your use case.
 *
 * Pattern 1: Static Import - Type-safe, production apps
 * Pattern 2: Dynamic Loading - Flexible, CLI/infrastructure
 * Pattern 3: Import from Image - Simplest, quick start
 * Pattern 4: No Image - Advanced, manual control (optional)
 */

// ============================================================================
// PATTERN 1: Static Import (Type-Safe, Library Use)
// ============================================================================
// Best for: Building specific applications, want type safety, know exact image needed
// Example: Custom Discord bot, web server

async function pattern1StaticImport() {
    // Step 1: Import image for side-effects (registers providers)
    await import('@dexto/image-local');

    // Step 2: Import from core (type-safe)
    const { DextoAgent, loadAgentConfig } = await import('@dexto/core');

    // Step 3: Load config and create agent
    const config = await loadAgentConfig('./agents/default.yml');
    const agent = new DextoAgent(config, './agents/default.yml');

    await agent.start();
    console.log('Pattern 1: Agent started with static import');
    await agent.stop();
}

// ============================================================================
// PATTERN 2: Dynamic Loading (Flexible, CLI/Config-Driven)
// ============================================================================
// Best for: Infrastructure, runtime flexibility, multi-tenant servers
// Example: Dexto CLI itself, platform servers

async function pattern2DynamicLoading() {
    const { DextoAgent, loadAgentConfig } = await import('@dexto/core');

    // Step 1: Load agent config first
    const config = await loadAgentConfig('./agents/default.yml');

    // Step 2: Determine image from multiple sources (priority order)
    const imageName =
        process.env.CLI_IMAGE_FLAG || // --image flag (from CLI args)
        config.image || // image field in agent config
        process.env.DEXTO_IMAGE; // DEXTO_IMAGE env var

    // Step 3: Dynamically load the image (if specified)
    if (imageName) {
        console.log(`Pattern 2: Loading image dynamically: ${imageName}`);
        await import(imageName);
    } else {
        console.log('Pattern 2: No image specified - running with core only');
    }

    // Step 4: Create agent (providers now registered)
    const agent = new DextoAgent(config, './agents/default.yml');

    await agent.start();
    console.log('Pattern 2: Agent started with dynamic loading');
    await agent.stop();
}

// ============================================================================
// PATTERN 3: Import from Image (All-in-One, Quick Start)
// ============================================================================
// Best for: Quick prototyping, getting started, small projects
// Example: Learning Dexto, tutorials, simple apps

async function pattern3ImportFromImage() {
    // Step 1: Import everything from the image (includes core re-exports)
    const { DextoAgent, loadAgentConfig } = await import('@dexto/image-local');
    // This works because image-local re-exports everything from core via wildcard

    // Step 2: Load config and create agent
    const config = await loadAgentConfig('./agents/default.yml');
    const agent = new DextoAgent(config, './agents/default.yml');

    await agent.start();
    console.log('Pattern 3: Agent started by importing from image');
    await agent.stop();
}

// ============================================================================
// PATTERN 4: No Image (Manual Provider Registration)
// ============================================================================
// Best for: Advanced users, custom infrastructure, minimal setups
// Example: Building your own distribution, Linux From Scratch approach

async function pattern4NoImage() {
    const { DextoAgent, loadAgentConfig, customToolRegistry } = await import('@dexto/core');

    // Optional: Manually register only the providers you need
    // const { fileSystemToolsProvider } = await import('@dexto/tools-filesystem');
    // customToolRegistry.register(fileSystemToolsProvider);

    // Load config (without any image field)
    const config = await loadAgentConfig('./agents/default.yml');

    // Create agent with no image - runs with core only
    const agent = new DextoAgent(config, './agents/default.yml');

    await agent.start();
    console.log('Pattern 4: Agent started with no image (core only)');
    await agent.stop();
}

// ============================================================================
// Usage Examples
// ============================================================================

async function main() {
    console.log('\n=== Demonstrating Image Loading Patterns ===\n');

    // Uncomment the pattern you want to try:

    // await pattern1StaticImport();
    // await pattern2DynamicLoading();
    await pattern3ImportFromImage(); // Default: simplest pattern
    // await pattern4NoImage();        // Advanced: no image, manual control
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

// ============================================================================
// CLI Usage Examples (Pattern 2)
// ============================================================================
/*

# Use default image
dexto run agents/default.yml

# Override with CLI flag (highest priority)
dexto --image @dexto/image-local run agents/default.yml

# Use image from config
# (Add `image: '@dexto/image-local'` to agent.yml)
dexto run agents/default.yml

# Use image from environment variable
export DEXTO_IMAGE=@dexto/image-local
dexto run agents/default.yml

*/

// ============================================================================
// Platform Model (Multi-tenant Server Example)
// ============================================================================
/*

// server.ts - Platform defines capabilities
import '@dexto/image-cloud';  // Platform choice (static or dynamic)
import { DextoAgent } from '@dexto/core';

// Load multiple tenant configs
app.post('/tenant/:id/run', async (req, res) => {
    const config = await loadTenantConfig(req.params.id);

    // Validate: does this agent's requirements match our platform?
    if (config.image && config.image !== '@dexto/image-cloud') {
        return res.status(400).json({
            error: `This platform runs @dexto/image-cloud, but agent requires ${config.image}`
        });
    }

    // Create agent - uses platform capabilities
    const agent = new DextoAgent(config, configPath);
    // ...
});

*/

// ============================================================================
// Comparison Table
// ============================================================================
/*

┌─────────────────────────────────────────────────────────────────────────────┐
│                        Pattern Comparison                                    │
├──────────────┬──────────────────┬──────────────────┬────────────────────────┤
│ Pattern      │ Type Safety      │ Flexibility      │ Best For               │
├──────────────┼──────────────────┼──────────────────┼────────────────────────┤
│ 1. Static    │ ✅ Full          │ ⚠️  Build-time   │ Production apps        │
│    Import    │                  │                  │ Type-safe libraries    │
├──────────────┼──────────────────┼──────────────────┼────────────────────────┤
│ 2. Dynamic   │ ⚠️  Runtime only │ ✅ Full          │ CLI tools              │
│    Loading   │                  │                  │ Multi-tenant servers   │
├──────────────┼──────────────────┼──────────────────┼────────────────────────┤
│ 3. From      │ ✅ Full          │ ⚠️  Build-time   │ Quick start            │
│    Image     │                  │                  │ Tutorials              │
├──────────────┼──────────────────┼──────────────────┼────────────────────────┤
│ 4. No Image  │ ✅ Full          │ ✅ Full          │ Advanced/custom        │
│    (Manual)  │                  │                  │ Minimal setups         │
└──────────────┴──────────────────┴──────────────────┴────────────────────────┘

Note: Pattern 4 gives you complete control - manually register exactly the
providers you need. This is the "Linux From Scratch" approach - maximum
flexibility but requires understanding the provider system.

*/
