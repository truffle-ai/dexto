#!/usr/bin/env node
/**
 * CLI entry point for observability dashboard
 * Usage: dexto-dashboard
 */

import { startDashboardServer } from '../server/dashboard-server.js';

startDashboardServer().catch((error) => {
    console.error('Failed to start dashboard:', error);
    process.exit(1);
});
