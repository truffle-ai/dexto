import { blobStoreRegistry } from './packages/core/dist/index.js';
await import('./packages/cli/dist/index.js');

console.log('✅ Registered providers:', blobStoreRegistry.getTypes());
console.log('✅ Supabase registered:', blobStoreRegistry.has('supabase'));

// Test validation
try {
  blobStoreRegistry.validateConfig({ type: 'supabase', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test', bucket: 'test' });
  console.log('✅ Supabase config validation works');
} catch (e) {
  console.log('❌ Validation failed:', e.message);
}
