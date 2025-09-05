// Re-export JSON with typing; compiled output will be .js
import data from './server-registry-data.json';
import type { ServerRegistryEntry } from '@/types.js';
export default data as ServerRegistryEntry[];
