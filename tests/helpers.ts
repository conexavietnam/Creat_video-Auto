import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.CREDENTIAL_KEY ??= '00'.repeat(32);
process.env.NODE_ENV = 'test';
delete process.env.VAID_APP_ID;
delete process.env.VAID_APP_SECRET;

if (!/_test$/.test(process.env.SQL_DB_NAME || '')) {
  throw new Error('Kiểm thử xóa dữ liệu bảng: đặt SQL_DB_NAME kết thúc bằng _test (ví dụ muse_test)');
}

const { db, createPool } = await import('../src/db/index.ts');
const { migrate } = await import('../src/server/migrate.ts');
const { refreshProviderConfigs } = await import('../src/server/providerConfig.ts');
const { requireSuperAdmin } = await import('../src/server/auth.ts');
const { createAdminRouter } = await import('../src/server/admin.ts');
const { createAccountsRouter } = await import('../src/server/accountRoutes.ts');
const { sql } = await import('drizzle-orm');

export { db };

export async function closeDatabase() {
  await createPool().end();
}

export async function resetDatabase() {
  await migrate();
  await db.execute(sql`TRUNCATE video_jobs, accounts, provider_settings, admin_audit_log, studio_cards RESTART IDENTITY`);
  await db.execute(sql`DELETE FROM app_settings`);
  await db.execute(sql`INSERT INTO app_settings (id) VALUES (1)`);
  await refreshProviderConfigs();
}

export function buildApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api', (req, res, next) => {
    const vaid = req.header('x-test-vaid');
    if (!vaid) return res.status(401).json({ success: false, error: 'Chưa đăng nhập' });
    res.locals.user = { vaid, name: `Người dùng ${vaid}` };
    next();
  });
  app.use('/api/accounts', createAccountsRouter());
  app.use('/api/admin', requireSuperAdmin, createAdminRouter());
  return app;
}

export interface TestServer {
  request(method: string, path: string, options?: { vaid?: string; body?: unknown }): Promise<{ status: number; text: string; json: any }>;
  close(): Promise<void>;
}

export async function startServer(): Promise<TestServer> {
  const server = http.createServer(buildApp());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    async request(method, path, options = {}) {
      const res = await fetch(base + path, {
        method,
        headers: { 'content-type': 'application/json', ...(options.vaid ? { 'x-test-vaid': options.vaid } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: res.status, text, json };
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await createPool().end();
    },
  };
}

export function adminRoutes(): Array<{ method: string; path: string }> {
  const router = createAdminRouter() as any;
  return router.stack
    .filter((layer: any) => layer.route)
    .flatMap((layer: any) => Object.keys(layer.route.methods).map(method => ({ method: method.toUpperCase(), path: layer.route.path as string })));
}
