import crypto from 'node:crypto';
import express, { NextFunction, Request, Response } from 'express';
import { deriveSubkey } from './crypto.ts';
import {
  buildGlobalSignoutUrl,
  buildLoaderUrl,
  createAppAdminCache,
  isValidAccessVerify,
  loadVaidConfigFromEnv,
  sha256Hex,
  verifyAccessVerify,
} from './vaid-kit/vaid.ts';
import { buildSessionCookie, resolveLoginMode } from './vaid-kit/embed-core.ts';
import { createVaidEmbedRouter } from './vaid-kit/express-embed.ts';

const COOKIE = 'muse_session';
const SESSION_TTL_SEC = 7 * 24 * 3600;
const CALLBACK_PATH = '/api/auth/vaid';
const SIGNOUT_PATH = '/api/auth/vaid/signout';
const REPLAY_TTL_MS = 10 * 60_000;
const IP_LIMIT = 10;
const GLOBAL_LIMIT = 60;

const isProduction = () => process.env.NODE_ENV === 'production';
const getClient = () => loadVaidConfigFromEnv();
const publicUrl = () => (process.env.VAID_PUBLIC_URL || '').trim().replace(/\/+$/, '');
const mode = () => resolveLoginMode();
const adminCache = createAppAdminCache(getClient);

interface SessionUser {
  vaid: string;
  name: string;
}

export function assertAuthConfigured() {
  if (!isProduction()) return;
  if (!getClient()) throw new Error('Thiếu VAID_APP_ID hoặc VAID_APP_SECRET ở môi trường production, từ chối khởi động để không mở API không đăng nhập');
  if (!publicUrl().startsWith('https://')) throw new Error('VAID_PUBLIC_URL phải là địa chỉ https:// công khai của ứng dụng');
}

export function isAuthRequired(): boolean {
  return isProduction() || !!getClient();
}

function sessionKey() {
  return deriveSubkey('muse-session-v1');
}

function signPayload(payload: string) {
  return crypto.createHmac('sha256', sessionKey()).update(payload).digest('base64url');
}

function createToken(user: SessionUser): string {
  const body = Buffer.from(JSON.stringify({ v: user.vaid, n: user.name.slice(0, 80), e: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC })).toString('base64url');
  return `${body}.${signPayload(body)}`;
}

function readCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === COOKIE) return rest.join('=');
  }
  return null;
}

function readSession(req: Request): SessionUser | null {
  const raw = readCookie(req);
  if (!raw) return null;
  const [body, signature] = raw.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(signPayload(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof data.v !== 'string' || !data.v || typeof data.e !== 'number' || data.e < Date.now() / 1000) return null;
    return { vaid: data.v, name: typeof data.n === 'string' ? data.n : '' };
  } catch {
    return null;
  }
}

type Resolved = { ok: true; user: SessionUser } | { ok: false; reason: 'none' | 'revoked' | 'unavailable' };

async function resolveUser(req: Request): Promise<Resolved> {
  if (!isAuthRequired()) return { ok: true, user: { vaid: 'local-dev', name: 'Dev' } };
  const user = readSession(req);
  if (!user) return { ok: false, reason: 'none' };
  if (mode() === 'user') return { ok: true, user };
  const check = await adminCache.check(user.vaid);
  if (!check.ok) return { ok: false, reason: 'unavailable' };
  return check.isAdmin === true ? { ok: true, user } : { ok: false, reason: 'revoked' };
}

function sessionCookie(token: string) {
  return buildSessionCookie(token, { name: COOKIE, maxAgeSec: SESSION_TTL_SEC, sameSite: 'Lax', secure: isProduction() });
}

function clearCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${isProduction() ? '; Secure' : ''}`;
}

function noStore(res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const resolved = await resolveUser(req);
  if (resolved.ok) {
    res.locals.user = resolved.user;
    return next();
  }
  if (resolved.reason === 'unavailable') {
    return res.status(503).json({ success: false, error: 'Không xác minh được quyền với VAWAY ID, vui lòng thử lại sau' });
  }
  if (resolved.reason === 'revoked') res.setHeader('Set-Cookie', clearCookie());
  res.status(401).json({ success: false, error: 'Chưa đăng nhập hoặc phiên đã hết hạn' });
}

export function superAdminVaids(): string[] {
  return (process.env.SUPERADMIN_VAIDS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

export function isSuperAdminVaid(vaid: string | undefined | null): boolean {
  if (!vaid) return false;
  return superAdminVaids().includes(vaid);
}

export function warnIfNoSuperAdmin() {
  if (superAdminVaids().length === 0) {
    console.warn('SUPERADMIN_VAIDS chưa được đặt: không ai vào được /admin (mọi /api/admin/* trả 404).');
  }
}

export function currentUser(res: Response): SessionUser {
  return res.locals.user as SessionUser;
}

export function requireSuperAdmin(_req: Request, res: Response, next: NextFunction) {
  const user = res.locals.user as SessionUser | undefined;
  if (!user || !isSuperAdminVaid(user.vaid)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy' });
  }
  next();
}

export function createAuthRouter(): express.Router {
  const router = express.Router();
  const replay = new Map<string, number>();
  const ipHits = new Map<string, { n: number; reset: number }>();
  let globalHits = { n: 0, reset: 0 };

  function limited(ip: string): boolean {
    const now = Date.now();
    for (const [key, until] of replay) if (until < now) replay.delete(key);
    for (const [key, hit] of ipHits) if (hit.reset < now) ipHits.delete(key);
    const hit = ipHits.get(ip);
    let over = false;
    if (!hit) ipHits.set(ip, { n: 1, reset: now + 60_000 });
    else if (++hit.n > IP_LIMIT) over = true;
    if (globalHits.reset < now) globalHits = { n: 1, reset: now + 60_000 };
    else if (++globalHits.n > GLOBAL_LIMIT) over = true;
    return over;
  }

  function callbackFail(res: Response, code: 'denied' | 'unavailable' | 'disabled' | 'busy') {
    noStore(res);
    res.redirect(302, `/#vaid_error=${code}`);
  }

  router.use(
    createVaidEmbedRouter({
      getClient,
      isAllowed: async vaid => {
        if (mode() === 'user') return true;
        const check = await adminCache.check(vaid);
        if (!check.ok) throw new Error('admin_check_failed');
        return check.isAdmin === true;
      },
      allowedOrigins: () => [publicUrl()],
      startSession: ({ vaid, name }) => createToken({ vaid, name }),
      sessionCookie: { name: COOKIE, maxAgeSec: SESSION_TTL_SEC, sameSite: 'Lax', secure: isProduction() },
    }),
  );

  router.get('/api/auth/status', async (req, res) => {
    noStore(res);
    const client = getClient();
    const resolved = await resolveUser(req);
    const base = publicUrl();
    const user = resolved.ok ? resolved.user : null;
    const vaid = client && base
      ? {
          appId: client.appId,
          loaderUrl: buildLoaderUrl({
            appId: client.appId,
            callback: `${base}${CALLBACK_PATH}`,
            signout: `${base}${SIGNOUT_PATH}?local=1`,
            name: user ? user.name || 'Thành viên' : undefined,
          }),
        }
      : null;
    res.json({
      success: true,
      data: {
        required: isAuthRequired(),
        authenticated: resolved.ok,
        unavailable: !resolved.ok && resolved.reason === 'unavailable',
        user: user ? { name: user.name } : null,
        vaid,
      },
    });
  });

  router.get(CALLBACK_PATH, async (req, res) => {
    const client = getClient();
    if (!client) return callbackFail(res, 'disabled');
    if (limited(req.ip || 'unknown')) return callbackFail(res, 'busy');
    const token = typeof req.query.access_verify === 'string' ? req.query.access_verify : '';
    if (!isValidAccessVerify(token)) return callbackFail(res, 'denied');
    const digest = sha256Hex(token);
    if (replay.has(digest)) return callbackFail(res, 'denied');
    replay.set(digest, Date.now() + REPLAY_TTL_MS);

    const verified = await verifyAccessVerify(client, token);
    if (!verified.ok) {
      if (verified.reason === 'timeout' || verified.reason === 'network') {
        replay.delete(digest);
        return callbackFail(res, 'unavailable');
      }
      return callbackFail(res, 'denied');
    }
    if (mode() === 'admin') {
      const check = await adminCache.check(verified.vaid);
      if (!check.ok) {
        replay.delete(digest);
        return callbackFail(res, 'unavailable');
      }
      if (!check.isAdmin) return callbackFail(res, 'denied');
    }
    noStore(res);
    res.setHeader('Set-Cookie', sessionCookie(createToken({ vaid: verified.vaid, name: verified.name })));
    res.redirect(302, '/');
  });

  router.get(SIGNOUT_PATH, (req, res) => {
    noStore(res);
    if (req.query.local !== '1') return res.redirect(302, '/');
    res.setHeader('Set-Cookie', clearCookie());
    res.redirect(302, '/#vaid_signout=1');
  });

  router.post('/api/auth/logout', (_req, res) => {
    noStore(res);
    res.setHeader('Set-Cookie', clearCookie());
    const client = getClient();
    const base = publicUrl();
    res.json({
      success: true,
      data: { globalSignoutUrl: client && base ? buildGlobalSignoutUrl(client.appId, `${base}/`) : null },
    });
  });

  return router;
}
