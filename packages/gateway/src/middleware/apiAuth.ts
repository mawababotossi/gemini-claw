/**
 * @license Apache-2.0
 * @clawgate/gateway — apiAuth middleware
 */
import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';

/**
 * Middleware requiring GEMINICLAW_API_TOKEN in Authorization: Bearer <token>
 * or in an HttpOnly cookie 'gc_session'.
 */
export function requireApiToken(req: Request, res: Response, next: NextFunction): void {
    const expectedToken = process.env['CLAWGATE_API_TOKEN'];

    if (!expectedToken) {
        if (process.env['NODE_ENV'] === 'production') {
            res.status(503).json({ error: 'CLAWGATE_API_TOKEN not configured.' });
            return;
        }
        console.warn('[api/auth] WARNING: API is unprotected in dev mode!');
        next();
        return;
    }

    // Support both Bearer token and HttpOnly Cookie
    let providedToken: string | undefined;

    const authHeader = req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
        providedToken = authHeader.slice(7);
    } else if (req.cookies && req.cookies['gc_session']) {
        providedToken = req.cookies['gc_session'];
    } else if (req.method === 'GET' && req.query['token']) {
        providedToken = req.query['token'] as string;
    }

    if (!providedToken) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }

    const provided = Buffer.from(providedToken);
    const expected = Buffer.from(expectedToken);

    // Padding for timingSafeEqual (identical lengths required)
    const maxLen = Math.max(provided.length, expected.length);
    const a = Buffer.concat([provided, Buffer.alloc(maxLen - provided.length)]);
    const b = Buffer.concat([expected, Buffer.alloc(maxLen - expected.length)]);

    if (!timingSafeEqual(a, b) || provided.length !== expected.length) {
        console.warn(`[api/auth] Bad token from ${req.ip}`);
        res.status(403).json({ error: 'Invalid token' });
        return;
    }

    next();
}
