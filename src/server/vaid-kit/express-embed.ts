/**
 * Adapter Express cho endpoint doi ma form nhung VAWAY ID.
 *
 *   app.set('trust proxy', 'loopback');
 *   app.use(createVaidEmbedRouter({ getClient, startSession, sessionCookie: { name: 'sid' } }));
 *   // hoac: app.post('/api/auth/vaid/code', vaidEmbedExpress({ ... }));
 *
 * Khong dung express.json() cho route nay: kit tu doc than voi gioi han 2 KB (neu da co middleware
 * parse JSON toan cuc thi kit dung req.body da parse).
 */
import express from 'express';
import type { Request, Response, Router } from 'express';
import { vaidEmbedAuth, EMBED_DEFAULT_PATH, EMBED_MAX_BODY_BYTES, readChunksLimited } from './embed-core.ts';
import type { VaidEmbedOptions } from './embed-core.ts';

export type { VaidEmbedOptions } from './embed-core.ts';

export function vaidEmbedExpress(opts: VaidEmbedOptions): (req: Request, res: Response) => Promise<void> {
  const handle = vaidEmbedAuth(opts);
  return async function (req: Request, res: Response): Promise<void> {
    const r = await handle({
      method: req.method,
      header: (n) => {
        const v = req.headers[n.toLowerCase()];
        return typeof v === 'string' ? v : Array.isArray(v) ? v[0] ?? null : null;
      },
      ip: req.ip,
      readBody: async (max) => {
        if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
          // middleware khac da parse
          const s = JSON.stringify(req.body);
          return Buffer.byteLength(s, 'utf8') > Math.min(max, EMBED_MAX_BODY_BYTES) ? null : s;
        }
        if (typeof req.body === 'string') return Buffer.byteLength(req.body, 'utf8') > max ? null : req.body;
        return readChunksLimited(req as AsyncIterable<Uint8Array>, max);
      }
    });
    for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
    if (r.setCookie.length) res.setHeader('Set-Cookie', r.setCookie);
    res.status(r.status).json(r.body);
  };
}

export function createVaidEmbedRouter(opts: VaidEmbedOptions & { path?: string }): Router {
  const router = express.Router();
  const path = opts.path || EMBED_DEFAULT_PATH;
  const h = vaidEmbedExpress(opts);
  router.all(path, (req, res, next) => {
    h(req, res).catch(next);
  });
  return router;
}
