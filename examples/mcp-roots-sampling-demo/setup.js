#!/usr/bin/env node

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { 
      stdio: 'inherit', 
      shell: true,
      cwd: __dirname,
      ...options 
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
}

async function main() {
  console.log('🚀 Setting up MCP Roots & Sampling Demo...\n');

  // Check if we're in the right directory
  if (!existsSync(join(__dirname, 'package.json'))) {
    console.error('❌ Please run this script from the demo directory');
    process.exit(1);
  }

  try {
    // Install dependencies
    console.log('📦 Installing dependencies...');
    await runCommand('npm', ['install']);
    console.log('✅ Dependencies installed\n');

    // Test server startup
    console.log('🧪 Testing server startup...');
    console.log('   Starting server for 3 seconds to verify it works...');
    
    const testProcess = spawn('node', ['server.js'], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let serverOutput = '';
    testProcess.stderr.on('data', (data) => {
      serverOutput += data.toString();
    });

    // Give the server 3 seconds to start up
    await new Promise(resolve => setTimeout(resolve, 3000));
    testProcess.kill();

    if (serverOutput.includes('Code Review Assistant MCP Server started')) {
      console.log('✅ Server startup test passed\n');
    } else {
      console.log('⚠️  Server started but output may be unexpected');
      console.log('   Server output:', serverOutput);
    }

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  }

  console.log('🎉 Setup complete!\n');
  console.log('Next steps:');
  console.log('1. Make sure you have Dexto built: pnpm run build');
  console.log('2. Test via CLI: dexto chat --agent examples/mcp-roots-sampling-demo/demo-agent.yml');
  console.log('3. Or test via WebUI: dexto serve --agent examples/mcp-roots-sampling-demo/demo-agent.yml');
  console.log('\nSee README.md for detailed usage examples! 📖');
}

main().catch(error => {
  console.error('Setup script failed:', error);
  process.exit(1);
});