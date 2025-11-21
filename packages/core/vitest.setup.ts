import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env file for integration tests
// This ensures environment variables are available during test execution
// Note: override is set to false to preserve CI environment variables
const result = config({
    path: resolve(__dirname, '../../.env'),
    override: false,
});

if (result.error && process.env.CI !== 'true') {
    console.warn('Warning: Failed to load .env file for tests:', result.error.message);
}
