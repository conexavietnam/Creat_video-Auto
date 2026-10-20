/**
 * Loi dung chung cua endpoint "doi ma" cho form nhung VAWAY ID (hop dong T29, muc 6.2).
 * Khong phu thuoc framework: express-embed.ts va web-embed.ts chi la lop mong doi Request/Response.
 *
 * Luong: SDK vaid.js (trang san pham) nhan `code` tu iframe id -> POST {code,state} toi endpoint nay ->
 *   1. kiem Origin / Sec-Fetch-Site cung nguon (chong CSRF "login CSRF"),
 *   2. gioi han toc do theo IP + toan he thong,
 *   3. kiem kieu/kich thuoc/hinh thuc body,
 *   4. exchangeEmbedCode (HMAC VAID-OAUTH-V1) -> vaid,
 *   5. isAllowed(vaid) (admin: id giu danh sach; user: moi nguoi), fail closed,
 *   6. startSession -> cookie phien cua san pham.
 * Tra ve {success:true,user:{vaid,name}} hoac {success:false,code} voi ma CHUNG; khong lo thong diep id.
 * KHONG BAO GIO log ma, state, secret hay cookie.
 */
import crypto from 'node:crypto';
import {
  type VaidConfig,
  type EmbedFailReason,
  EMBED_CODE_RE,
  EMBED_STATE_RE,
  exchangeEmbedCode,
  createAppAdminCache
} from './vaid.ts';

export const EMBED_ERROR_CODES = ['denied', 'unavailable', 'disabled', 'busy', 'invalid'] as const;
export type EmbedErrorCode = (typeof EMBED_ERROR_CODES)[number];

export const EMBED_DEFAULT_PATH = '/api/auth/vaid/code';
export const EMBED_MAX_BODY_BYTES = 2048;
const IP_LIMIT = 10; // so lan / IP / phut
const GLOBAL_LIMIT = 60; // so lan goi id / phut toan he thong
const MAX_IP_ENTRIES = 5000;

export interface EmbedSessionResult {
  /** Gia tri Set-Cookie day du do san pham dung (mot hoac nhieu). */
  setCookie?: string | string[];
  /** Hoac tra token: kit tu dat cookie theo `sessionCookie`. */
  token?: string;
}

export interface SessionCookieOptions {
  name: string;
  maxAgeSec?: number; // mac dinh 7 ngay
  path?: string; // mac dinh /
  sameSite?: 'Lax' | 'Strict';
  /** Mac dinh true. Chi dat false khi chay http://localhost de thu. */
  secure?: boolean;
}

export interface VaidEmbedOptions {
  /** Cau hinh id (null = tat -> 'disabled'). Ham de doc lai moi yeu cau. */
  getClient: () => VaidConfig | null;
  /**
   * vaid nao duoc phep. Bo trong -> suy ra tu `loginMode` (admin: hoi id qua createAppAdminCache.check; user: luon true).
   * NEM LOI khi khong xac minh duoc => 'unavailable', khong tao phien (fail closed).
   */
  isAllowed?: (vaid: string) => boolean | Promise<boolean>;
  /** 'admin' (mac dinh, an toan) | 'user'. Mac dinh doc env LOGIN_MODE; gia tri la => admin. */
  loginMode?: 'admin' | 'user';
  /** Tao phien san pham theo vaid. Tra token (kit dat cookie) hoac {setCookie}. Throw => 'unavailable'. */
  startSession: (user: { vaid: string; name: string }, ctx: { ip: string }) => string | EmbedSessionResult | Promise<string | EmbedSessionResult>;
  /** Dung khi startSession tra token. */
  sessionCookie?: SessionCookieOptions;
  /**
   * Origin duoc chap nhan (vi du ['https://data.vaway.vn']). Rat nen dat (VAID_PUBLIC_URL).
   * Neu bo trong: Origin phai co cung host voi header Host.
   */
  allowedOrigins?: string[] | (() => string[]);
  /** Kiem them state theo he thong rieng cua san pham (tuy chon). false => 'invalid'. */
  validateState?: (state: string) => boolean | Promise<boolean>;
  /** Lay IP that. Mac dinh: req.ip cua Express (theo 'trust proxy') hoac header X-Real-IP do nginx dat (adapter Web); khong co => 'unknown'. */
  getClientIp?: (headers: (name: string) => string | null) => string;
  /** Ghi log su kien co dinh (khong co ma/secret). Mac dinh console.warn. */
  logger?: (event: string, info: Record<string, string>) => void;
  nowMs?: () => number;
}

/** Yeu cau da trung hoa tu framework. */
export interface EmbedRequest {
  method: string;
  header: (name: string) => string | null;
  /** IP do framework biet (Express req.ip); co the bo trong. */
  ip?: string;
  /** Doc than yeu cau toi da `max` byte; tra null neu vuot qua. Chi goi sau khi Origin/rate-limit da qua. */
  readBody: (max: number) => Promise<string | null>;
}

export interface EmbedResponse {
  status: number;
  body: { success: true; user: { vaid: string; name: string } } | { success: false; code: EmbedErrorCode };
  setCookie: string[];
  headers: Record<string, string>;
}

export function buildSessionCookie(token: string, o: SessionCookieOptions): string {
  if (!/^[A-Za-z0-9._~+\/=-]{1,4096}$/.test(token)) throw new Error('bad_token');
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(o.name)) throw new Error('bad_cookie_name');
  const parts = [`${o.name}=${token}`, `Path=${o.path || '/'}`, `Max-Age=${Math.max(1, Math.floor(o.maxAgeSec ?? 7 * 24 * 3600))}`, 'HttpOnly', `SameSite=${o.sameSite || 'Lax'}`];
  if (o.secure !== false) parts.push('Secure');
  return parts.join('; ');
}

const BASE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
};

const STATUS: Record<EmbedErrorCode, number> = { denied: 403, unavailable: 502, disabled: 503, busy: 429, invalid: 400 };

function fail(code: EmbedErrorCode, extra: Record<string, string> = {}): EmbedResponse {
  return { status: STATUS[code], body: { success: false, code }, setCookie: [], headers: { ...BASE_HEADERS, ...extra } };
}

/** Anh xa ly do that bai cua exchangeEmbedCode sang ma chung (khong lo thong diep/chi tiet id). */
export function mapEmbedReason(reason: EmbedFailReason): EmbedErrorCode {
  switch (reason) {
    case 'code_invalid':
    case 'code_expired':
    case 'code_used':
    case 'app_mismatch':
    case 'state_mismatch':
    case 'invalid_input':
      return 'invalid';
    case 'rate_limit':
      return 'busy';
    case 'disabled':
    case 'not_configured':
      return 'disabled';
    default:
      // unauthorized, bad_request, rejected, timeout, network, bad_response: loi phia he thong/cau hinh
      return 'unavailable';
  }
}

export function resolveLoginMode(explicit?: string, env: Record<string, string | undefined> = process.env): 'admin' | 'user' {
  const v = (explicit ?? env.LOGIN_MODE ?? '').trim().toLowerCase();
  return v === 'user' ? 'user' : 'admin';
}

function normOrigin(o: string): string | null {
  try {
    const u = new URL(o);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Tao ham xu ly trung lap dung chung cho moi framework. */
export function vaidEmbedAuth(opts: VaidEmbedOptions): (req: EmbedRequest) => Promise<EmbedResponse> {
  const now = opts.nowMs || (() => Date.now());
  const log =
    opts.logger ||
    ((event: string, info: Record<string, string>) => {
      console.warn('[vaid-embed]', event, JSON.stringify(info));
    });
  const mode = resolveLoginMode(opts.loginMode);
  let adminCache: ReturnType<typeof createAppAdminCache> | null = null;
  const isAllowed: (vaid: string) => boolean | Promise<boolean> =
    opts.isAllowed ||
    (mode === 'user'
      ? () => true
      : async (vaid: string) => {
          adminCache ||= createAppAdminCache(opts.getClient);
          const r = await adminCache.check(vaid);
          if (!r.ok) throw new Error('admin_check_failed');
          return r.isAdmin === true;
        });

  const ipHits = new Map<string, { n: number; reset: number }>();
  let globalHits = { n: 0, reset: 0 };

  function rateLimited(ip: string): boolean {
    const t = now();
    if (ipHits.size > MAX_IP_ENTRIES) {
      for (const [k, v] of ipHits) if (v.reset < t) ipHits.delete(k);
      if (ipHits.size > MAX_IP_ENTRIES) ipHits.clear();
    }
    let limited = false;
    const h = ipHits.get(ip);
    if (!h || h.reset < t) ipHits.set(ip, { n: 1, reset: t + 60_000 });
    else if (++h.n > IP_LIMIT) limited = true;
    if (globalHits.reset < t) globalHits = { n: 1, reset: t + 60_000 };
    else if (++globalHits.n > GLOBAL_LIMIT) limited = true;
    return limited;
  }

  function allowedOrigins(): string[] {
    const raw = typeof opts.allowedOrigins === 'function' ? opts.allowedOrigins() : opts.allowedOrigins || [];
    return raw.map(normOrigin).filter((x): x is string => !!x);
  }

  /** Cung nguon: Origin bat buoc co; Sec-Fetch-Site (neu co) phai same-origin; Origin thuoc danh sach hoac cung host voi Host. */
  function sameOrigin(req: EmbedRequest): string | null {
    const origin = req.header('origin');
    if (!origin || origin === 'null') return null;
    const sfs = req.header('sec-fetch-site');
    if (sfs !== null && sfs.toLowerCase() !== 'same-origin') return null;
    const o = normOrigin(origin);
    if (!o) return null;
    const list = allowedOrigins();
    if (list.length > 0) return list.includes(o) ? o : null;
    const host = (req.header('host') || '').toLowerCase();
    if (!host) return null;
    try {
      return new URL(o).host.toLowerCase() === host ? o : null;
    } catch {
      return null;
    }
  }

  return async function handle(req: EmbedRequest): Promise<EmbedResponse> {
    if (req.method.toUpperCase() !== 'POST') {
      return { ...fail('invalid'), status: 405, headers: { ...BASE_HEADERS, Allow: 'POST' } };
    }
    const origin = sameOrigin(req);
    if (!origin) {
      log('origin_rejected', {});
      return fail('denied');
    }
    const cfg = opts.getClient();
    if (!cfg) return fail('disabled');

    const ipRaw = opts.getClientIp
      ? opts.getClientIp(req.header)
      : req.ip || req.header('x-real-ip') || 'unknown';
    const ip = String(ipRaw || 'unknown').slice(0, 64);
    if (rateLimited(ip)) {
      log('rate_limited', {});
      return fail('busy', { 'Retry-After': '60' });
    }

    const ctype = (req.header('content-type') || '').toLowerCase();
    if (!/^application\/json\s*(;|$)/.test(ctype)) return fail('invalid');
    const clen = req.header('content-length');
    if (clen !== null && (!/^\d{1,9}$/.test(clen) || Number(clen) > EMBED_MAX_BODY_BYTES)) return fail('invalid');

    let raw: string | null;
    try {
      raw = await req.readBody(EMBED_MAX_BODY_BYTES);
    } catch {
      return fail('invalid');
    }
    if (raw === null || raw.length === 0 || Buffer.byteLength(raw, 'utf8') > EMBED_MAX_BODY_BYTES) return fail('invalid');
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail('invalid');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('invalid');
    const code = parsed.code;
    const state = parsed.state;
    if (typeof code !== 'string' || !EMBED_CODE_RE.test(code)) return fail('invalid');
    if (typeof state !== 'string' || !EMBED_STATE_RE.test(state)) return fail('invalid');

    if (opts.validateState) {
      let okState = false;
      try {
        okState = (await opts.validateState(state)) === true;
      } catch {
        okState = false;
      }
      if (!okState) return fail('invalid');
    }

    const r = await exchangeEmbedCode(cfg, { code, state });
    if (!r.ok) {
      const mapped = mapEmbedReason(r.reason);
      log('exchange_failed', { reason: r.reason, code: mapped });
      return fail(mapped);
    }
    // id tra origin gan voi ma: phai trung nguon dang goi (neu id tra)
    if (r.origin && normOrigin(r.origin) !== origin) {
      log('origin_mismatch', {});
      return fail('invalid');
    }

    let allowed = false;
    try {
      allowed = (await isAllowed(r.user.vaid)) === true;
    } catch {
      log('allow_check_failed', {});
      return fail('unavailable');
    }
    if (!allowed) {
      log('denied', {});
      return fail('denied');
    }

    let sess: string | EmbedSessionResult;
    try {
      sess = await opts.startSession({ vaid: r.user.vaid, name: r.user.name }, { ip });
    } catch {
      log('session_failed', {});
      return fail('unavailable');
    }
    const cookies: string[] = [];
    try {
      if (typeof sess === 'string') {
        if (!opts.sessionCookie) throw new Error('no_cookie_options');
        cookies.push(buildSessionCookie(sess, opts.sessionCookie));
      } else if (sess && typeof sess === 'object') {
        if (typeof sess.token === 'string') {
          if (!opts.sessionCookie) throw new Error('no_cookie_options');
          cookies.push(buildSessionCookie(sess.token, opts.sessionCookie));
        }
        const sc = sess.setCookie;
        if (typeof sc === 'string') cookies.push(sc);
        else if (Array.isArray(sc)) cookies.push(...sc.filter((c): c is string => typeof c === 'string'));
      }
      if (cookies.length === 0 || cookies.some((c) => /[\r\n]/.test(c))) throw new Error('no_cookie');
    } catch {
      log('session_failed', {});
      return fail('unavailable');
    }
    return {
      status: 200,
      body: { success: true, user: { vaid: r.user.vaid, name: r.user.name } },
      setCookie: cookies,
      headers: { ...BASE_HEADERS }
    };
  };
}

/** Doc luong byte toi da `max`; null neu vuot. Dung chung cho adapter. */
export async function readChunksLimited(chunks: AsyncIterable<Uint8Array | string>, max: number): Promise<string | null> {
  const parts: Buffer[] = [];
  let total = 0;
  for await (const c of chunks) {
    const b = typeof c === 'string' ? Buffer.from(c, 'utf8') : Buffer.from(c);
    total += b.length;
    if (total > max) return null;
    parts.push(b);
  }
  return Buffer.concat(parts).toString('utf8');
}

/** Tien ich: so sanh hang thoi gian hai chuoi (dung khi san pham tu kiem them). */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
