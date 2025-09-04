#!/usr/bin/env tsx
/**
 * Test script for init-app functionality using local packages
 * Bypasses npm installation and uses local @dexto/core build
 */

import {
    createDextoDirectories,
    createDextoConfigFile,
    createDextoExampleFile,
    postInitDexto,
} from '../packages/cli/src/cli/commands/init-app.js';
import path from 'path';
import fs from 'fs-extra';

async function testInitApp() {
    console.log('🧪 Testing init-app functionality with local packages...\n');

    // Get test directory from command line or use default
    const testDir = process.argv[2] || '/tmp/test-dexto-init';
    const dextoSubdir = 'src';

    console.log(`📁 Test directory: ${testDir}`);
    console.log(`📁 Dexto subdirectory: ${dextoSubdir}\n`);

    try {
        // Ensure test directory exists and is clean
        if (await fs.pathExists(testDir)) {
            const shouldContinue = process.argv.includes('--force');
            if (!shouldContinue) {
                console.log(
                    '❌ Test directory exists. Use --force to overwrite or delete it manually.'
                );
                process.exit(1);
            }
            await fs.remove(path.join(testDir, dextoSubdir, 'dexto'));
        } else {
            await fs.ensureDir(testDir);
        }

        process.chdir(testDir);

        // Skip the package installation step and go directly to file creation
        console.log('📋 Creating Dexto directories...');
        const dirResult = await createDextoDirectories(dextoSubdir);
        if (!dirResult.ok) {
            console.log('✅ Dexto directory already exists, continuing...');
        }

        console.log('📄 Creating config file...');
        const configPath = await createDextoConfigFile(path.join(dextoSubdir, 'dexto', 'agents'));
        console.log(`✅ Config created at: ${configPath}`);

        console.log('📝 Creating example file...');
        const examplePath = await createDextoExampleFile(path.join(dextoSubdir, 'dexto'));
        console.log(`✅ Example created at: ${examplePath}`);

        // Read and verify the example file content
        const exampleContent = await fs.readFile(examplePath, 'utf8');

        console.log('\n🔍 Verification:');
        console.log(`✅ Uses @dexto/core: ${exampleContent.includes("from '@dexto/core'")}`);
        console.log(
            `✅ Correct config path: ${exampleContent.includes(`'${dextoSubdir}/dexto/agents/default-agent.yml'`)}`
        );
        console.log(`✅ Has agent examples: ${exampleContent.includes('agent.run(')}`);

        console.log('\n📦 Manual setup required:');
        console.log('1. npm install dotenv yaml');
        console.log('2. npm link @dexto/core  # Use local built version');
        console.log('3. Add API key to .env');
        console.log(
            `4. Run: node --loader ts-node/esm ${path.join(dextoSubdir, 'dexto', 'dexto-example.ts')}`
        );

        await postInitDexto(dextoSubdir);
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testInitApp();
}
