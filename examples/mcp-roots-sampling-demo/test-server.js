#!/usr/bin/env node

// Simple test to verify the MCP server responds correctly
// This sends basic MCP protocol messages to test server functionality

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function testServer() {
  console.log('🧪 Testing MCP Code Review Server...\n');

  const server = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let responseData = '';

  server.stdout.on('data', (data) => {
    responseData += data.toString();
  });

  server.stderr.on('data', (data) => {
    console.log('Server log:', data.toString().trim());
  });

  // Test 1: Initialize
  console.log('📋 Test 1: Initialize connection...');
  const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {
        roots: { listChanged: true },
        sampling: {}
      },
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    }
  };
  
  server.stdin.write(JSON.stringify(initRequest) + '\n');

  // Test 2: List tools
  setTimeout(() => {
    console.log('🔧 Test 2: List available tools...');
    const toolsRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {}
    };
    server.stdin.write(JSON.stringify(toolsRequest) + '\n');
  }, 1000);

  // Test 3: List roots
  setTimeout(() => {
    console.log('📁 Test 3: Request roots...');
    const rootsRequest = {
      jsonrpc: '2.0',
      id: 3,
      method: 'roots/list',
      params: {}
    };
    server.stdin.write(JSON.stringify(rootsRequest) + '\n');
  }, 2000);

  // Test 4: Call a tool
  setTimeout(() => {
    console.log('📄 Test 4: Call list_project_files tool...');
    const toolRequest = {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'list_project_files',
        arguments: { extension: '.js' }
      }
    };
    server.stdin.write(JSON.stringify(toolRequest) + '\n');
  }, 3000);

  // Clean up after tests
  setTimeout(() => {
    server.kill();
    
    console.log('\n📊 Test Results:');
    
    if (responseData.includes('"result"')) {
      console.log('✅ Server responded to requests');
    } else {
      console.log('❌ No valid responses received');
    }

    if (responseData.includes('tools')) {
      console.log('✅ Tools endpoint working');
    }

    if (responseData.includes('roots')) {
      console.log('✅ Roots endpoint working');
    }

    if (responseData.includes('review_code')) {
      console.log('✅ Code review tools available');
    }

    console.log('\n📝 Full server responses:');
    console.log(responseData || 'No responses captured');

    console.log('\n🎯 Server test complete!');
    console.log('If you see ✅ marks above, the server is working correctly.');
  }, 5000);
}

testServer().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});