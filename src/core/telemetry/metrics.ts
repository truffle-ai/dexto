import { metrics, Counter } from '@opentelemetry/api';

// Declare the counter, but don't initialize it yet.
export let apiRequestsCounter: Counter;

export function initializeMetrics() {
    const meter = metrics.getMeter('dexto-agent');
    apiRequestsCounter = meter.createCounter('dexto_api_requests_total', {
        description: 'Total number of API requests',
    });
}
