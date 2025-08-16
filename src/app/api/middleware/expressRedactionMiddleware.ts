import { redactSensitiveData } from '@core/utils/redactor.js';
import type { Request, Response, NextFunction } from 'express';

/**
 * Express middleware to redact sensitive data from all outgoing responses.
 * Patches res.json and res.send to apply redaction before sending data.
 * Usage: app.use('/api/llm', expressRedactionMiddleware);
 */
export function expressRedactionMiddleware(req: Request, res: Response, next: NextFunction) {
    // Patch res.json
    const originalJson = res.json.bind(res);
    res.json = (data) => {
        const redacted = redactSensitiveData(data);
        return originalJson(redacted);
    };
    // Patch res.send (for string responses)
    const originalSend = res.send.bind(res);
    res.send = (body) => {
        if (typeof body === 'string') {
            body = redactSensitiveData(body);
        }
        return originalSend(body);
    };
    next();
}
