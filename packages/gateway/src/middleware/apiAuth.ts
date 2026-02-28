/**
 * @license Apache-2.0
 * API Authentication Middleware
 */
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';

/**
 * Middleware that requires a Bearer token in the Authorization header.
 * Token is read from DASHBOARD_SECRET environment variable.
 */
export function requireApiToken(req: Request, res: Response, next: NextFunction): void {
    const expectedToken = process.env['DASHBOARD_SECRET'];

    // In development mode, if no secret is set, allow with a warning
    if (!expectedToken) {
        if (process.env['NODE_ENV'] === 'production') {
            res.status(503).json({
                error: 'API authentication is not configured. Set DASHBOARD_SECRET in your .env file.'
            });
            return;
        }
        console.warn('[api/auth] WARNING: DASHBOARD_SECRET is not set. API is unprotected!');
        return next();
    }

    const authHeader = req.headers['authorization'];
    let providedToken: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        providedToken = authHeader.slice('Bearer '.length);
    } else if (req.query['token'] && typeof req.query['token'] === 'string') {
        providedToken = req.query['token'];
    }

    if (!providedToken) {
        res.status(401).json({ error: 'Missing or invalid authentication. Provide Bearer token or ?token= query parameter.' });
        return;
    }

    try {
        // Constant-time comparison to prevent timing attacks
        const bufProvided = Buffer.from(providedToken);
        const bufExpected = Buffer.from(expectedToken);

        if (bufProvided.length === bufExpected.length && timingSafeEqual(bufProvided, bufExpected)) {
            return next();
        }
    } catch (err) {
        // Fallback or error handling
    }

    console.warn(`[api/auth] Unauthorized access attempt from ${req.ip}`);
    res.status(403).json({ error: 'Invalid API token' });
}
