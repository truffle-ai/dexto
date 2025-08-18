import { apiRequestsCounter } from '@core/telemetry/metrics.js';
import type { Request, Response, NextFunction } from 'express';

/**
 * Express middleware to count all incoming API requests for telemetry purposes.
 * Records method, route path, and status code after the response finishes.
 */
export function telemetryRequestCounter(req: Request, res: Response, next: NextFunction) {
    // Guard against apiRequestsCounter not being initialized yet (race condition during startup)
    if (apiRequestsCounter) {
        // Record metrics only after the response has finished, so statusCode is available
        res.on('finish', () => {
            apiRequestsCounter?.add(1, {
                method: req.method,
                route: req.route?.path ?? 'unknown', // Use low-cardinality route path
                status: String(res.statusCode),
            });
        });
    }
    next();
}
