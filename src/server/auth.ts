import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';

const COOKIE = 'muse_session';

function expectedSession(): string | null {
  const token = process.env.APP_ACCESS_TOKEN;
  if (!token) return null;
  return crypto.createHmac('sha256', token).update('muse-session-v1').digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function isAuthRequired(): boolean {
  return !!process.env.APP_ACCESS_TOKEN;
}

export function isAuthenticated(req: Request): boolean {
  const expected = expectedSession();
  if (!expected) return true;
  const cookie = readCookie(req, COOKIE);
  return !!cookie && safeEqual(cookie, expected);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ success: false, error: 'Chưa đăng nhập hoặc phiên đã hết hạn' });
}

export function login(req: Request, res: Response) {
  const expectedToken = process.env.APP_ACCESS_TOKEN;
  if (!expectedToken) return res.json({ success: true });
  const provided = String(req.body?.token || '');
  if (!safeEqual(provided, expectedToken)) {
    return res.status(401).json({ success: false, error: 'Mã truy cập không đúng' });
  }
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${expectedSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}`);
  res.json({ success: true });
}

export function logout(_req: Request, res: Response) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
  res.json({ success: true });
}
