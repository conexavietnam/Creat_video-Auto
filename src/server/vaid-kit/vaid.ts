/**
 * VAWAY ID kit (vaid.ts) - dung chung cho moi san pham Node/Express.
 * Khong phu thuoc thu vien ngoai (chi node:crypto + fetch co san).
 *
 * Gom:
 *  - xac minh `access_verify` -> thong tin nguoi dung (vaid, ten) qua id.vaway.vn
 *  - chu ky HMAC cho API id (profile) va cho /account/notify (thong bao)
 *  - gui thong bao Telegram cho nguoi dung qua id (san pham khong giu token bot)
 *  - kiem chu ky thong bao/webhook phia nhan (verifyNotifySignature)
 *  - dung URL loader / URL dang xuat toan cuc
 *  - quan tri vien cua san pham do id giu (nguon su that): list / check / set + bo nho dem ngan
 *  - form nhung (embed): oauthSignature + exchangeEmbedCode doi ma mot lan lay vaid (xem embed-core.ts)
 *
 * Moi ham mang tinh thuan tuy; goi mang chi qua `fetchImpl` (tiem duoc khi test).
 * KHONG bao gio log hoac tra ve app_secret/access_verify.
 */
import crypto from 'node:crypto';

export const ID_ORIGIN = 'https://id.vaway.vn';
export const DEFAULT_PROFILE_URL = 'https://id.vaway.vn/api/v1/account/profile';
export const DEFAULT_NOTIFY_URL = 'https://api.s5.vaway.vn/account/notify';
export const NOTIFY_SIGN_PREFIX = 'VAID-NOTIFY-V1';
export const DEFAULT_API_BASE = 'https://api.s5.vaway.vn';
export const APPADMIN_SIGN_PREFIX = 'VAID-APPADMIN-V1';
export const OAUTH_SIGN_PREFIX = 'VAID-OAUTH-V1';
export const DEFAULT_ADMIN_CACHE_MS = 60_000;
/** Chi cho phep goi toi cac host nay (chong SSRF khi cau hinh sai/bi chen). */
export const ALLOWED_API_HOSTS = ['id.vaway.vn', 'api.s5.vaway.vn'];

export interface VaidConfig {
  appId: string;
  appSecret: string;
  /** Tuy chon: neu co, goi API id theo kieu `Authorization: key=md5(key|secret|app_id)` (nhu meeting). Khong co -> dung chu ky HMAC (chi can secret). */
  appKey?: string;
  profileUrl?: string;
  notifyUrl?: string;
  /** Goc API quan tri vien cua app (mac dinh https://api.s5.vaway.vn; chi cho phep host trong ALLOWED_API_HOSTS). */
  apiBase?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Ham lay thoi gian (giay) - tiem de test. */
  nowSec?: () => number;
  /** Chi dung trong test de cho phep host gia lap. */
  extraAllowedHosts?: string[];
}

export type VerifyFailReason =
  | 'not_configured'
  | 'invalid_token' // dinh dang access_verify sai (khong goi mang)
  | 'rejected' // id tu choi (token het han/sai)
  | 'timeout'
  | 'network'
  | 'bad_response';

export type VerifyResult =
  | { ok: true; vaid: string; name: string; phone?: string; email?: string }
  | { ok: false; reason: VerifyFailReason };

// ---------------------------------------------------------------- primitives

export function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

export function hmacSha256Hex(secret: string, message: string): string {
  return crypto.createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

/** Tuong duong urlencode() cua PHP (de ra cung chuoi voi http_build_query phia id). */
export function phpUrlencode(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, '+');
}

/** Tuong duong http_build_query($arr) cho mang phang, giu thu tu khoa. */
export function phpBuildQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .map((k) => `${phpUrlencode(k)}=${phpUrlencode(params[k])}`)
    .join('&');
}

/** Chu ky goi API id: hex(HMAC-SHA256(secret, http_build_query(params))) - params KHONG gom signature. */
export function signParams(appSecret: string, params: Record<string, string>): string {
  return hmacSha256Hex(appSecret, phpBuildQuery(params));
}

/** Chu ky thong bao: hex(HMAC-SHA256(secret, "VAID-NOTIFY-V1\n<app_id>\n<ts>\n"+sha256hex(body))). */
export function notifySignature(appSecret: string, appId: string, timestamp: number | string, body: string): string {
  return hmacSha256Hex(appSecret, `${NOTIFY_SIGN_PREFIX}\n${appId}\n${timestamp}\n${sha256Hex(body)}`);
}

/**
 * Kiem tra chu ky thong bao/webhook (phia nhan). Tra true khi khop va timestamp lech <= skewSec.
 */
export function verifyNotifySignature(opts: {
  appSecret: string;
  appId: string;
  timestamp: string | number;
  signature: string;
  body: string;
  nowSec?: number;
  skewSec?: number;
}): boolean {
  const ts = Number(opts.timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (opts.skewSec ?? 300)) return false;
  if (typeof opts.signature !== 'string' || !/^[0-9a-f]{64}$/i.test(opts.signature)) return false;
  const expected = notifySignature(opts.appSecret, opts.appId, String(opts.timestamp), opts.body);
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(opts.signature.toLowerCase(), 'hex'));
}

/**
 * Chu ky API quan tri vien app: hex(HMAC-SHA256(secret, "VAID-APPADMIN-V1\n<app_id>\n<ts>\n"+sha256hex(body))).
 * Cung kieu voi notify, khac tien to.
 */
export function appAdminSignature(appSecret: string, appId: string, timestamp: number | string, body: string): string {
  return hmacSha256Hex(appSecret, `${APPADMIN_SIGN_PREFIX}\n${appId}\n${timestamp}\n${sha256Hex(body)}`);
}

/**
 * Chu ky doi ma form nhung: hex(HMAC-SHA256(secret, "VAID-OAUTH-V1\n<app_id>\n<ts>\n"+sha256hex(body))).
 * `body` PHAI la dung chuoi byte se gui.
 */
export function oauthSignature(appSecret: string, appId: string, timestamp: number | string, body: string): string {
  return hmacSha256Hex(appSecret, `${OAUTH_SIGN_PREFIX}\n${appId}\n${timestamp}\n${sha256Hex(body)}`);
}

// ---------------------------------------------------------------- helpers

/** access_verify hop le ve hinh thuc (tranh gui rac sang id). */
export function isValidAccessVerify(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9._~-]{8,200}$/.test(v);
}

export function isAllowedVaid(vaid: unknown, allowed: readonly string[] | undefined | null): boolean {
  if (typeof vaid !== 'string' || !vaid) return false;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.some((a) => typeof a === 'string' && a.trim().toLowerCase() === vaid.trim().toLowerCase());
}

/** Doi HTML (Telegram) sang van ban thuong: bo the, giai ma &lt; &gt; &amp;. */
export function htmlToPlainText(html: string): string {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function buildLoaderUrl(opts: {
  appId: string;
  callback: string;
  signout?: string;
  /** Co ten (khac rong) = bao cho loader biet san pham dang dang nhap. */
  name?: string;
  idOrigin?: string;
}): string {
  const origin = opts.idOrigin || ID_ORIGIN;
  let url = `${origin}/libraries/v3/?app_id=${encodeURIComponent(opts.appId)}&callback=${encodeURIComponent(opts.callback)}`;
  if (opts.signout) url += `&signout=${encodeURIComponent(opts.signout)}`;
  if (opts.name) url += `&users[name]=${encodeURIComponent(opts.name)}`;
  return url;
}

export function buildGlobalSignoutUrl(appId: string, returnUrl: string, idOrigin: string = ID_ORIGIN): string {
  return `${idOrigin}/connect/vaidsignout?app_id=${encodeURIComponent(appId)}&return=${encodeURIComponent(returnUrl)}`;
}

/** Doc cau hinh tu bien moi truong. Tra null neu thieu app_id hoac app_secret (= tinh nang tat). */
export function loadVaidConfigFromEnv(env: Record<string, string | undefined> = process.env): VaidConfig | null {
  const appId = (env.VAID_APP_ID || '').trim();
  const appSecret = (env.VAID_APP_SECRET || '').trim();
  if (!appId || !appSecret) return null;
  const cfg: VaidConfig = { appId, appSecret };
  if (env.VAID_APP_KEY && env.VAID_APP_KEY.trim()) cfg.appKey = env.VAID_APP_KEY.trim();
  if (env.VAID_PROFILE_URL) cfg.profileUrl = env.VAID_PROFILE_URL.trim();
  if (env.VAID_NOTIFY_URL) cfg.notifyUrl = env.VAID_NOTIFY_URL.trim();
  if (env.VAID_API_BASE && env.VAID_API_BASE.trim()) cfg.apiBase = env.VAID_API_BASE.trim().replace(/\/+$/, '');
  const t = Number(env.VAID_TIMEOUT_MS);
  if (Number.isFinite(t) && t > 0) cfg.timeoutMs = t;
  return cfg;
}

// ---------------------------------------------------------------- network

function checkUrl(cfg: VaidConfig, url: string): URL {
  const u = new URL(url);
  const hosts = [...ALLOWED_API_HOSTS, ...(cfg.extraAllowedHosts || [])];
  if (!hosts.includes(u.hostname)) throw new Error('host_not_allowed');
  if (u.protocol !== 'https:' && !(cfg.extraAllowedHosts || []).includes(u.hostname)) throw new Error('https_required');
  return u;
}

async function fetchWithTimeout(
  cfg: VaidConfig,
  url: string,
  init: RequestInit
): Promise<{ status: number; text: string }> {
  const f = cfg.fetchImpl || fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 8000);
  try {
    const res = await f(url, { ...init, signal: ctrl.signal, redirect: 'error' });
    const text = (await res.text()).slice(0, 100_000);
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function classifyNetworkError(err: unknown): 'timeout' | 'network' {
  const name = (err as any)?.name;
  return name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'network';
}

/**
 * Xac minh access_verify bang cach goi account/profile cua id (giong meeting).
 * Chi tin `access_verify` tu client; vaid/ten lay tu phan hoi cua id.
 */
export async function verifyAccessVerify(cfg: VaidConfig | null | undefined, accessVerify: unknown): Promise<VerifyResult> {
  if (!cfg || !cfg.appId || !cfg.appSecret) return { ok: false, reason: 'not_configured' };
  if (!isValidAccessVerify(accessVerify)) return { ok: false, reason: 'invalid_token' };

  let url: URL;
  try {
    url = checkUrl(cfg, cfg.profileUrl || DEFAULT_PROFILE_URL);
  } catch {
    return { ok: false, reason: 'not_configured' };
  }

  const params: Record<string, string> = { access_token: accessVerify, app_id: cfg.appId };
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
  let body: string;
  if (cfg.appKey) {
    headers['Authorization'] = 'key=' + crypto.createHash('md5').update(`${cfg.appKey}|${cfg.appSecret}|${cfg.appId}`).digest('hex');
    body = phpBuildQuery(params);
  } else {
    body = phpBuildQuery(params) + '&signature=' + signParams(cfg.appSecret, params);
  }

  let resp: { status: number; text: string };
  try {
    resp = await fetchWithTimeout(cfg, url.toString(), { method: 'POST', headers, body });
  } catch (err) {
    return { ok: false, reason: classifyNetworkError(err) };
  }

  let json: any;
  try {
    json = JSON.parse(resp.text);
  } catch {
    return { ok: false, reason: 'bad_response' };
  }
  if (resp.status >= 500) return { ok: false, reason: 'network' };
  if (!json || json.success !== true) {
    // id tra success=false cho token sai/het han, hoac thieu xac thuc app
    return { ok: false, reason: json && typeof json === 'object' && 'success' in json ? 'rejected' : 'bad_response' };
  }
  const d = json.data;
  const vaid = d && (d._id || d.vaid || d.id);
  if (!d || typeof vaid !== 'string' || !vaid) return { ok: false, reason: 'bad_response' };
  const out: VerifyResult = {
    ok: true,
    vaid,
    name: typeof d.name === 'string' && d.name ? d.name : typeof d.fullname === 'string' ? d.fullname : ''
  };
  if (typeof d.phone === 'string') out.phone = d.phone;
  if (typeof d.email === 'string') out.email = d.email;
  return out;
}

export interface NotifyResult {
  success: boolean;
  error?: string;
}

/**
 * Gui thong bao Telegram cho nguoi dung (theo vaid) qua dich vu id.
 * POST notifyUrl, headers X-Vaid-App / X-Vaid-Timestamp / X-Vaid-Signature, body JSON {vaid,text,purpose}.
 */
export async function sendNotify(
  cfg: VaidConfig | null | undefined,
  msg: { vaid: string; text: string; purpose?: string }
): Promise<NotifyResult> {
  if (!cfg || !cfg.appId || !cfg.appSecret) return { success: false, error: 'not_configured' };
  if (!msg || typeof msg.vaid !== 'string' || !msg.vaid) return { success: false, error: 'missing_vaid' };
  if (typeof msg.text !== 'string' || !msg.text.trim()) return { success: false, error: 'empty_text' };

  let url: URL;
  try {
    url = checkUrl(cfg, cfg.notifyUrl || DEFAULT_NOTIFY_URL);
  } catch {
    return { success: false, error: 'not_configured' };
  }

  const body = JSON.stringify({ vaid: msg.vaid, text: msg.text, purpose: msg.purpose || 'alert' });
  const ts = (cfg.nowSec ? cfg.nowSec() : Math.floor(Date.now() / 1000)).toString();
  const headers = {
    'Content-Type': 'application/json',
    'X-Vaid-App': cfg.appId,
    'X-Vaid-Timestamp': ts,
    'X-Vaid-Signature': notifySignature(cfg.appSecret, cfg.appId, ts, body)
  };

  let resp: { status: number; text: string };
  try {
    resp = await fetchWithTimeout(cfg, url.toString(), { method: 'POST', headers, body });
  } catch (err) {
    return { success: false, error: classifyNetworkError(err) };
  }
  let json: any = null;
  try {
    json = JSON.parse(resp.text);
  } catch {
    /* khong phai JSON */
  }
  if (resp.status >= 200 && resp.status < 300 && json && json.success === true) return { success: true };
  const m = json && typeof json.message === 'string' ? json.message.slice(0, 200) : `http_${resp.status}`;
  return { success: false, error: m };
}

// ================================================================ quan tri vien app (id giu nguon su that)

export interface AppAdmin {
  vaid: string;
  name: string;
  role: string;
}

export type AppAdminFailReason = 'not_configured' | 'timeout' | 'network' | 'bad_response' | 'rejected';

export type AppAdminListResult =
  | { ok: true; admins: AppAdmin[]; updatedAt: string | null; etag: string | null }
  | { ok: false; reason: AppAdminFailReason; status?: number };

export type AppAdminCheckResult =
  | { ok: true; isAdmin: boolean; role: string | null }
  | { ok: false; reason: AppAdminFailReason; status?: number };

export interface AppAdminChange {
  /** Moi muc co `vaid` HOAC `phone` (id tu tim nguoi theo SDT). `role` tuy chon. */
  vaid?: string;
  phone?: string;
  role?: string;
}

export interface AppAdminSetError {
  ref: string;
  code: string;
}

export type AppAdminSetResult =
  | { ok: true; added: string[]; removed: string[]; errors: AppAdminSetError[] }
  | { ok: false; reason: AppAdminFailReason; code?: string; status?: number };

/** Goi API quan tri vien app (POST JSON co chu ky VAID-APPADMIN-V1). Khong bao gio log secret. */
async function callAppAdmin(
  cfg: VaidConfig | null | undefined,
  path: 'list' | 'check' | 'set',
  payload: Record<string, unknown>
): Promise<{ ok: true; json: any; status: number } | { ok: false; reason: AppAdminFailReason; status?: number }> {
  if (!cfg || !cfg.appId || !cfg.appSecret) return { ok: false, reason: 'not_configured' };
  let url: URL;
  try {
    url = checkUrl(cfg, `${(cfg.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '')}/account/app/admins/${path}`);
  } catch {
    return { ok: false, reason: 'not_configured' };
  }
  const body = JSON.stringify(payload);
  const ts = (cfg.nowSec ? cfg.nowSec() : Math.floor(Date.now() / 1000)).toString();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Vaid-App': cfg.appId,
    'X-Vaid-Timestamp': ts,
    'X-Vaid-Signature': appAdminSignature(cfg.appSecret, cfg.appId, ts, body)
  };
  let resp: { status: number; text: string };
  try {
    resp = await fetchWithTimeout(cfg, url.toString(), { method: 'POST', headers, body });
  } catch (err) {
    return { ok: false, reason: classifyNetworkError(err) };
  }
  if (resp.status >= 500) return { ok: false, reason: 'network', status: resp.status };
  let json: any;
  try {
    json = JSON.parse(resp.text);
  } catch {
    return { ok: false, reason: 'bad_response', status: resp.status };
  }
  if (!json || typeof json !== 'object') return { ok: false, reason: 'bad_response', status: resp.status };
  return { ok: true, json, status: resp.status };
}

function cleanStr(v: unknown, max = 200): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

/** Danh sach quan tri vien cua app tu id. Chi giu vaid/ten/vai tro (khong bao gio SDT). */
export async function listAppAdmins(cfg: VaidConfig | null | undefined): Promise<AppAdminListResult> {
  const r = await callAppAdmin(cfg, 'list', {});
  if (!r.ok) return r;
  if (r.json.success !== true) return { ok: false, reason: 'rejected', status: r.status };
  if (!Array.isArray(r.json.admins)) return { ok: false, reason: 'bad_response', status: r.status };
  const admins: AppAdmin[] = [];
  for (const a of r.json.admins) {
    if (!a || typeof a.vaid !== 'string' || !a.vaid) return { ok: false, reason: 'bad_response', status: r.status };
    admins.push({ vaid: a.vaid, name: cleanStr(a.name), role: cleanStr(a.role, 40) || 'admin' });
  }
  return {
    ok: true,
    admins,
    updatedAt: typeof r.json.updated_at === 'string' ? r.json.updated_at : null,
    etag: typeof r.json.etag === 'string' ? r.json.etag : null
  };
}

/** `vaid` co phai quan tri vien cua app khong (id tra loi). Loi mang/timeout => ok:false (nguoi goi PHAI tu choi). */
export async function checkAppAdmin(cfg: VaidConfig | null | undefined, vaid: string): Promise<AppAdminCheckResult> {
  if (typeof vaid !== 'string' || !vaid || vaid.length > 100) return { ok: true, isAdmin: false, role: null };
  const r = await callAppAdmin(cfg, 'check', { vaid });
  if (!r.ok) return r;
  if (r.json.success !== true || typeof r.json.is_admin !== 'boolean') return { ok: false, reason: 'bad_response', status: r.status };
  return { ok: true, isAdmin: r.json.is_admin, role: r.json.is_admin && typeof r.json.role === 'string' ? r.json.role : null };
}

/** Them/go quan tri vien o id. `actorVaid` phai la admin hien tai cua app (id kiem). */
export async function setAppAdmins(
  cfg: VaidConfig | null | undefined,
  opts: { actorVaid: string; add?: AppAdminChange[]; remove?: string[] }
): Promise<AppAdminSetResult> {
  const add = (opts.add || []).map((a) => {
    const o: Record<string, string> = {};
    if (a.vaid) o.vaid = a.vaid;
    else if (a.phone) o.phone = a.phone;
    if (a.role) o.role = a.role;
    return o;
  });
  const r = await callAppAdmin(cfg, 'set', { actor_vaid: opts.actorVaid, add, remove: opts.remove || [] });
  if (!r.ok) return r;
  const res = r.json.results;
  if (r.json.success !== true || !res || typeof res !== 'object') {
    const code = cleanStr(r.json.code || r.json.error, 60);
    return { ok: false, reason: 'rejected', code: /^[A-Z_]{3,40}$/.test(code) ? code : undefined, status: r.status };
  }
  const ids = (arr: unknown): string[] =>
    Array.isArray(arr) ? arr.map((x: any) => (x && typeof x.vaid === 'string' ? x.vaid : '')).filter(Boolean) : [];
  const errors: AppAdminSetError[] = Array.isArray(res.errors)
    ? res.errors.map((e: any) => ({ ref: cleanStr(e && e.ref, 100), code: cleanStr(e && e.code, 60) || 'UNKNOWN' }))
    : [];
  return { ok: true, added: ids(res.added), removed: ids(res.removed), errors };
}

export interface AppAdminCache {
  /** Danh sach (cache TTL; loi chi duoc nho ~5 giay de khong don dap id). */
  list(): Promise<AppAdminListResult>;
  /** Kiem 1 vaid (cache TTL theo vaid). */
  check(vaid: string): Promise<AppAdminCheckResult>;
  /** Goi set o id roi XOA cache (nguoi goi tu kiem quyen truoc). */
  set(opts: { actorVaid: string; add?: AppAdminChange[]; remove?: string[] }): Promise<AppAdminSetResult>;
  invalidate(): void;
  /** So admin lan cuoi biet tu id (null = chua biet). Dung cho chot chong tu khoa. */
  lastKnownCount(): number | null;
}

/**
 * Bo nho dem ngan quanh list/check. Mac dinh 60 giay; loi (mang/timeout/...) KHONG bao gio duoc coi la "admin".
 * Cac lan goi dong thoi cung khoa duoc gop thanh 1 yeu cau toi id.
 */
export function createAppAdminCache(
  getCfg: () => VaidConfig | null,
  opts: { ttlMs?: number; errorTtlMs?: number; nowMs?: () => number; maxEntries?: number } = {}
): AppAdminCache {
  const ttl = opts.ttlMs ?? DEFAULT_ADMIN_CACHE_MS;
  const errTtl = Math.min(opts.errorTtlMs ?? 5000, ttl);
  const now = opts.nowMs || (() => Date.now());
  const maxEntries = opts.maxEntries ?? 500;
  type Entry<T> = { v: T; exp: number };
  let listEntry: Entry<AppAdminListResult> | null = null;
  let lastCount: number | null = null;
  const checks = new Map<string, Entry<AppAdminCheckResult>>();
  const inflight = new Map<string, Promise<any>>();
  let gen = 0; // tang khi invalidate: ket qua dang bay cua the he cu khong duoc ghi vao cache

  function dedupe<T>(key: string, run: () => Promise<T>): Promise<T> {
    const cur = inflight.get(key);
    if (cur) return cur as Promise<T>;
    const p = run().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  const self: AppAdminCache = {
    async list() {
      if (listEntry && listEntry.exp > now()) return listEntry.v;
      const g = gen;
      return dedupe('list@' + g, async () => {
        const r = await listAppAdmins(getCfg());
        if (g === gen) {
          listEntry = { v: r, exp: now() + (r.ok ? ttl : errTtl) };
          if (r.ok) lastCount = r.admins.length;
        }
        return r;
      });
    },
    async check(vaid) {
      const hit = checks.get(vaid);
      if (hit && hit.exp > now()) return hit.v;
      const g = gen;
      return dedupe(`check@${g}@${vaid}`, async () => {
        const r = await checkAppAdmin(getCfg(), vaid);
        if (g === gen) {
          if (checks.size >= maxEntries) {
            for (const [k, v] of checks) if (v.exp <= now()) checks.delete(k);
            if (checks.size >= maxEntries) checks.clear();
          }
          checks.set(vaid, { v: r, exp: now() + (r.ok ? ttl : errTtl) });
        }
        return r;
      });
    },
    async set(o) {
      const r = await setAppAdmins(getCfg(), o);
      // Du thanh cong hay that bai/khong ro ket qua, xoa cache de lan doc sau lay su that tu id.
      self.invalidate();
      return r;
    },
    invalidate() {
      gen++;
      listEntry = null;
      checks.clear();
    },
    lastKnownCount() {
      return lastCount;
    }
  };
  return self;
}

// ================================================================ form nhung (embed): doi ma mot lan

export const EMBED_CODE_RE = /^[0-9a-f]{48}$/;
export const EMBED_STATE_RE = /^[A-Za-z0-9_-]{8,128}$/;

export interface EmbedUser {
  vaid: string;
  name: string;
  phone?: string;
  email?: string;
  telegramLinked?: boolean;
}

/** Ly do that bai. `code_*`/`app_mismatch`/`state_mismatch`/`rate_limit`/`disabled` la ma id tra (HTTP 200); con lai la mang/HTTP. */
export type EmbedFailReason =
  | 'not_configured'
  | 'invalid_input' // ma/state sai dinh dang (khong goi mang)
  | 'code_invalid'
  | 'code_expired'
  | 'code_used'
  | 'app_mismatch'
  | 'state_mismatch'
  | 'rate_limit' // ma RATE_LIMIT hoac HTTP 429
  | 'disabled' // ma DISABLED hoac HTTP 503 (tat khan cap)
  | 'unauthorized' // HTTP 401: chu ky/het han/replay (thuong do secret/app_id/dong ho sai)
  | 'bad_request' // HTTP 400
  | 'rejected' // success:false voi ma khong biet
  | 'timeout'
  | 'network' // loi ket noi hoac HTTP 5xx khac 503
  | 'bad_response';

export type EmbedExchangeResult =
  | { ok: true; user: EmbedUser; state: string; origin: string | null }
  | { ok: false; reason: EmbedFailReason; status?: number };

const EMBED_ID_CODE_MAP: Record<string, EmbedFailReason> = {
  CODE_INVALID: 'code_invalid',
  CODE_EXPIRED: 'code_expired',
  CODE_USED: 'code_used',
  APP_MISMATCH: 'app_mismatch',
  STATE_MISMATCH: 'state_mismatch',
  RATE_LIMIT: 'rate_limit',
  DISABLED: 'disabled'
};

/**
 * Doi ma mot lan cua form nhung lay thong tin nguoi dung (hop dong 4.2).
 * KHONG bao gio coi loi la thanh cong: chi `{ok:true}` khi id tra success:true + vaid hop le + state khop.
 */
export async function exchangeEmbedCode(
  cfg: VaidConfig | null | undefined,
  input: { code: unknown; state: unknown }
): Promise<EmbedExchangeResult> {
  if (!cfg || !cfg.appId || !cfg.appSecret) return { ok: false, reason: 'not_configured' };
  const { code, state } = input || ({} as any);
  if (typeof code !== 'string' || !EMBED_CODE_RE.test(code)) return { ok: false, reason: 'invalid_input' };
  if (typeof state !== 'string' || !EMBED_STATE_RE.test(state)) return { ok: false, reason: 'invalid_input' };

  let url: URL;
  try {
    url = checkUrl(cfg, `${(cfg.apiBase || DEFAULT_API_BASE).replace(/\/+$/, '')}/account/oauth/exchange`);
  } catch {
    return { ok: false, reason: 'not_configured' };
  }

  const body = JSON.stringify({ code, state });
  const ts = (cfg.nowSec ? cfg.nowSec() : Math.floor(Date.now() / 1000)).toString();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Vaid-App': cfg.appId,
    'X-Vaid-Timestamp': ts,
    'X-Vaid-Signature': oauthSignature(cfg.appSecret, cfg.appId, ts, body)
  };

  let resp: { status: number; text: string };
  try {
    resp = await fetchWithTimeout(cfg, url.toString(), { method: 'POST', headers, body });
  } catch (err) {
    return { ok: false, reason: classifyNetworkError(err) };
  }
  const st = resp.status;
  if (st === 401) return { ok: false, reason: 'unauthorized', status: st };
  if (st === 429) return { ok: false, reason: 'rate_limit', status: st };
  if (st === 503) return { ok: false, reason: 'disabled', status: st };
  if (st === 400) return { ok: false, reason: 'bad_request', status: st };
  if (st >= 500) return { ok: false, reason: 'network', status: st };
  if (st < 200 || st >= 300) return { ok: false, reason: 'bad_response', status: st };

  let json: any;
  try {
    json = JSON.parse(resp.text);
  } catch {
    return { ok: false, reason: 'bad_response', status: st };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, reason: 'bad_response', status: st };
  if (json.success !== true) {
    const c = typeof json.code === 'string' ? json.code : '';
    if (Object.prototype.hasOwnProperty.call(EMBED_ID_CODE_MAP, c)) return { ok: false, reason: EMBED_ID_CODE_MAP[c], status: st };
    return { ok: false, reason: 'success' in json ? 'rejected' : 'bad_response', status: st };
  }
  const u = json.user;
  if (!u || typeof u !== 'object' || typeof u.vaid !== 'string' || !u.vaid || u.vaid.length > 200) {
    return { ok: false, reason: 'bad_response', status: st };
  }
  if (json.state !== state) return { ok: false, reason: 'state_mismatch', status: st };
  const user: EmbedUser = { vaid: u.vaid, name: typeof u.name === 'string' ? u.name.slice(0, 200) : '' };
  if (typeof u.phone === 'string') user.phone = u.phone;
  if (typeof u.email === 'string') user.email = u.email;
  if (typeof u.telegram_linked === 'boolean') user.telegramLinked = u.telegram_linked;
  return { ok: true, user, state, origin: typeof json.origin === 'string' ? json.origin : null };
}
