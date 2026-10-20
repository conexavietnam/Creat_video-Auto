// Kiểm thử đăng nhập VAWAY ID với id thật. Chạy trên VPS: export CREDENTIAL_KEY=$(openssl rand -hex 32) $(grep '^VAID_|^LOGIN_MODE' ~/app.env | xargs); unset NODE_ENV; npx tsx scripts/test-auth-live.mts
import crypto from 'node:crypto';
import express from 'express';
import { assertAuthConfigured, createAuthRouter, requireAuth } from '../src/server/auth.ts';

process.env.CREDENTIAL_KEY ||= crypto.randomBytes(32).toString('hex');
const PUBLIC = process.env.VAID_PUBLIC_URL!;
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, info = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  (' + info + ')'}`);
}

function token(vaid: string, exp = Math.floor(Date.now() / 1000) + 3600, tamper = false) {
  const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(process.env.CREDENTIAL_KEY!, 'hex'), Buffer.alloc(0), 'muse-session-v1', 32));
  const body = Buffer.from(JSON.stringify({ v: vaid, n: 'Test', e: exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return tamper ? `${body}.${sig.slice(0, -2)}xx` : `${body}.${sig}`;
}

assertAuthConfigured();
const app = express();
app.set('trust proxy', 'loopback');
app.use(createAuthRouter());
app.use('/api', requireAuth);
app.get('/api/ping', (_req, res) => res.json({ ok: true }));
const server = app.listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
const get = (path: string, cookie?: string, extra: RequestInit = {}) =>
  fetch(base + path, { redirect: 'manual', ...extra, headers: { ...(cookie ? { cookie: `muse_session=${cookie}` } : {}), ...(extra.headers as any) } });

let r = await get('/api/ping');
check('API khong cookie bi chan 401', r.status === 401, String(r.status));

r = await get('/api/ping', token('1', undefined, true));
check('Cookie bi sua chu ky bi chan 401', r.status === 401, String(r.status));

r = await get('/api/ping', token('1', Math.floor(Date.now() / 1000) - 10));
check('Cookie het han bi chan 401', r.status === 401, String(r.status));

r = await get('/api/ping', token('1'));
check('Quan tri vien do id xac nhan (vaid 1) vao duoc 200', r.status === 200, String(r.status));

r = await get('/api/ping', token('2'));
check('Nguoi khong phai quan tri vien (vaid 2) bi chan 401', r.status === 401, String(r.status));
check('Bi thu quyen thi cookie bi xoa', /Max-Age=0/.test(r.headers.get('set-cookie') || ''));

r = await get('/api/auth/status');
let j: any = await r.json();
check('status: required=true, authenticated=false', j.data.required === true && j.data.authenticated === false);
check('status: co appId va loaderUrl dung', j.data.vaid?.appId === process.env.VAID_APP_ID && j.data.vaid.loaderUrl.includes(`app_id=${process.env.VAID_APP_ID}`) && j.data.vaid.loaderUrl.includes('signout='), JSON.stringify(j.data.vaid));
check('status khong lo secret', !JSON.stringify(j).includes(process.env.VAID_APP_SECRET!));

r = await get('/api/auth/status', token('1'));
j = await r.json();
check('status voi cookie hop le: authenticated=true', j.data.authenticated === true && j.data.user?.name === 'Test');

r = await get('/api/auth/vaid?access_verify=abc');
check('Callback ma sai dinh dang -> denied', r.status === 302 && (r.headers.get('location') || '').endsWith('#vaid_error=denied'), `${r.status} ${r.headers.get('location')}`);

const fake = crypto.randomBytes(24).toString('hex');
r = await get(`/api/auth/vaid?access_verify=${fake}`);
check('Callback ma gia (id that tu choi) -> denied, khong cap cookie', r.status === 302 && (r.headers.get('location') || '').endsWith('#vaid_error=denied') && !r.headers.get('set-cookie'), `${r.status} ${r.headers.get('location')}`);

r = await get(`/api/auth/vaid?access_verify=${fake}`);
check('Callback lap lai cung ma -> denied', (r.headers.get('location') || '').endsWith('#vaid_error=denied'));

r = await get('/api/auth/vaid/signout?local=1');
check('signout?local=1 xoa cookie va ve /#vaid_signout=1', r.status === 302 && r.headers.get('location') === '/#vaid_signout=1' && /Max-Age=0/.test(r.headers.get('set-cookie') || ''));
r = await get('/api/auth/vaid/signout');
check('signout khong local=1 khong xoa cookie', r.status === 302 && r.headers.get('location') === '/' && !r.headers.get('set-cookie'));

r = await get('/api/auth/logout', undefined, { method: 'POST' });
j = await r.json();
check('logout tra URL dang xuat toan cuc cua id', j.success && String(j.data.globalSignoutUrl).startsWith('https://id.vaway.vn/connect/vaidsignout?app_id=' + process.env.VAID_APP_ID), JSON.stringify(j));
check('logout xoa cookie', /Max-Age=0/.test(r.headers.get('set-cookie') || ''));

r = await get('/api/auth/vaid/code', undefined, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'a'.repeat(48), state: 'b'.repeat(16) }) });
j = await r.json();
check('Form nhung khong co Origin -> denied 403', r.status === 403 && j.code === 'denied', `${r.status} ${JSON.stringify(j)}`);

r = await get('/api/auth/vaid/code', undefined, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: PUBLIC, 'sec-fetch-site': 'same-origin' },
  body: JSON.stringify({ code: 'a'.repeat(48), state: 'b'.repeat(16) }),
});
j = await r.json();
check('Form nhung ma gia: id nhan chu ky va bao ma sai (invalid 400, khong phai unavailable)', r.status === 400 && j.code === 'invalid', `${r.status} ${JSON.stringify(j)}`);

server.close();
console.log(`\n${pass} dat, ${fail} loi`);
process.exit(fail ? 1 : 0);
