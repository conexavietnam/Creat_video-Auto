import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { adminRoutes, db, resetDatabase, startServer, TestServer } from './helpers.ts';

const { sql } = await import('drizzle-orm');
const { effectiveModel } = await import('../src/server/providerConfig.ts');
const { getProvider } = await import('../src/server/providers/index.ts');
const { resolveProvider } = await import('../src/server/jobs.ts');
const { todayInVietnam } = await import('../src/server/adminStats.ts');

let server: TestServer;
const SUPER = '1';
const OTHER = '2';

before(async () => {
  server = await startServer();
});

after(async () => {
  await server.close();
});

beforeEach(async () => {
  process.env.SUPERADMIN_VAIDS = SUPER;
  await resetDatabase();
});

const sampleBody = (method: string) => (method === 'GET' || method === 'DELETE' ? undefined : { name: 'x', credential: 'y', enabled: true });

describe('AD-01 / AD-02: phân quyền', () => {
  it('liệt kê được đủ route admin để không sót', () => {
    assert.ok(adminRoutes().length >= 12, `chỉ thấy ${adminRoutes().length} route`);
  });

  it('người không thuộc SUPERADMIN_VAIDS nhận 404 ở mọi route admin', async () => {
    for (const route of adminRoutes()) {
      const path = '/api/admin' + route.path.replace(/:id/g, '1');
      const res = await server.request(route.method, path, { vaid: OTHER, body: sampleBody(route.method) });
      assert.equal(res.status, 404, `${route.method} ${path} phải 404 nhưng nhận ${res.status}`);
    }
    assert.equal((await server.request('GET', '/api/admin/khong-co-route', { vaid: OTHER })).status, 404);
  });

  it('chưa đăng nhập nhận 401, không phải 404', async () => {
    assert.equal((await server.request('GET', '/api/admin/me')).status, 401);
  });

  it('superadmin vào được', async () => {
    const res = await server.request('GET', '/api/admin/me', { vaid: SUPER });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.vaid, SUPER);
  });

  it('không đặt SUPERADMIN_VAIDS thì không ai vào được, kể cả id 1', async () => {
    delete process.env.SUPERADMIN_VAIDS;
    for (const route of adminRoutes()) {
      const path = '/api/admin' + route.path.replace(/:id/g, '1');
      const res = await server.request(route.method, path, { vaid: SUPER, body: sampleBody(route.method) });
      assert.equal(res.status, 404, `${route.method} ${path} phải 404 khi chưa cấu hình`);
    }
    process.env.SUPERADMIN_VAIDS = '';
    assert.equal((await server.request('GET', '/api/admin/me', { vaid: SUPER })).status, 404);
  });

  it('danh sách nhiều id, có khoảng trắng', async () => {
    process.env.SUPERADMIN_VAIDS = ' 7 , 1 ';
    assert.equal((await server.request('GET', '/api/admin/me', { vaid: '7' })).status, 200);
    assert.equal((await server.request('GET', '/api/admin/me', { vaid: '1' })).status, 200);
    assert.equal((await server.request('GET', '/api/admin/me', { vaid: '17' })).status, 404);
  });
});

describe('AD-08: các route ghi khóa cũ chỉ cho superadmin', () => {
  it('non-superadmin: đọc được danh sách, ghi bị 404', async () => {
    assert.equal((await server.request('GET', '/api/accounts', { vaid: OTHER })).status, 200);
    const post = await server.request('POST', '/api/accounts', { vaid: OTHER, body: { name: 'a', credential: 'b', providerId: 'mock' } });
    assert.equal(post.status, 404);
    assert.equal((await server.request('PATCH', '/api/accounts/1', { vaid: OTHER, body: { maxSlots: 2 } })).status, 404);
    assert.equal((await server.request('DELETE', '/api/accounts/1', { vaid: OTHER })).status, 404);
    const rows = await db.execute(sql`SELECT count(*)::int AS n FROM accounts`);
    assert.equal((rows.rows[0] as any).n, 0);
  });

  it('superadmin vẫn thêm được qua route cũ', async () => {
    const post = await server.request('POST', '/api/accounts', { vaid: SUPER, body: { name: 'a', credential: 'b', providerId: 'mock' } });
    assert.equal(post.status, 200);
    assert.equal(post.json.data.sessionStatus, 'online');
  });
});

describe('AD-03 / AD-07: khóa không lộ ra ngoài', () => {
  it('khóa không xuất hiện trong phản hồi, danh sách tài khoản và nhật ký', async () => {
    const first = 'KHOA-BI-MAT-9f3a71c2';
    const second = 'KHOA-MOI-2b7c55e0';
    const responses: string[] = [];
    const record = <T extends { text: string }>(res: T): T => {
      responses.push(res.text);
      return res;
    };

    const added = record(await server.request('POST', '/api/admin/providers/mock/accounts', { vaid: SUPER, body: { name: 'Khóa thử', credential: first, maxSlots: 2 } }));
    assert.equal(added.status, 200);
    assert.match(added.json.data.maskedIdentifier, /^usr_\*\*\*[0-9a-f]{4}$/);
    assert.equal(added.json.data.sessionStatus, 'online');
    const id = added.json.data.id;

    const rotated = record(await server.request('PUT', `/api/admin/accounts/${id}/credential`, { vaid: SUPER, body: { credential: second } }));
    assert.equal(rotated.status, 200);
    assert.notEqual(rotated.json.data.maskedIdentifier, added.json.data.maskedIdentifier);

    record(await server.request('PATCH', `/api/admin/accounts/${id}`, { vaid: SUPER, body: { name: 'Đổi tên', maxSlots: 3 } }));
    record(await server.request('POST', `/api/admin/accounts/${id}/health`, { vaid: SUPER }));
    for (const path of ['/api/admin/providers', '/api/admin/settings', '/api/admin/stats', '/api/admin/audit?limit=200']) {
      record(await server.request('GET', path, { vaid: SUPER }));
    }
    record(await server.request('GET', '/api/accounts', { vaid: OTHER }));
    record(await server.request('PUT', '/api/admin/providers/mock', { vaid: SUPER, body: { notes: 'ghi chú thường' } }));
    record(await server.request('DELETE', `/api/admin/accounts/${id}`, { vaid: SUPER }));

    const audit = await db.execute(sql`SELECT action, target, detail FROM admin_audit_log ORDER BY id`);
    const auditText = JSON.stringify(audit.rows);
    for (const secret of [first, second, 'encryptedCredential', 'encrypted_credential']) {
      for (const body of responses) assert.ok(!body.includes(secret), `phản hồi lộ "${secret}"`);
      assert.ok(!auditText.includes(secret), `nhật ký lộ "${secret}"`);
    }
    const actions = audit.rows.map((r: any) => r.action);
    assert.deepEqual(actions, ['account.add', 'account.rotate', 'account.update', 'provider.update', 'account.delete']);
  });

  it('thêm khóa vào provider chưa khả dụng, tài khoản trống hoặc slot sai bị từ chối', async () => {
    const flow = await server.request('POST', '/api/admin/providers/flow/accounts', { vaid: SUPER, body: { name: 'a', credential: 'b' } });
    assert.equal(flow.status, 400);
    assert.equal((await server.request('POST', '/api/admin/providers/mock/accounts', { vaid: SUPER, body: { name: '', credential: 'b' } })).status, 400);
    assert.equal((await server.request('POST', '/api/admin/providers/mock/accounts', { vaid: SUPER, body: { name: 'a', credential: 'b', maxSlots: 99 } })).status, 400);
    assert.equal((await server.request('POST', '/api/admin/providers/khong-co/accounts', { vaid: SUPER, body: { name: 'a', credential: 'b' } })).status, 400);
    assert.equal((await server.request('PUT', '/api/admin/accounts/999/credential', { vaid: SUPER, body: { credential: 'b' } })).status, 404);
  });
});

describe('AD-04 / AD-05: cấu hình provider', () => {
  it('tắt provider thì resolveProvider từ chối kèm lý do, bật lại thì chạy được', async () => {
    assert.ok('provider' in (await resolveProvider('mock')));
    const off = await server.request('PUT', '/api/admin/providers/mock', { vaid: SUPER, body: { enabled: false } });
    assert.equal(off.status, 200);
    assert.equal(off.json.data.available, false);
    assert.equal(off.json.data.unavailableReason, 'Đã bị quản trị viên tắt');
    assert.equal(getProvider('mock')?.available, false);
    const refused = await resolveProvider('mock');
    assert.ok('error' in refused && /quản trị viên/.test(refused.error));

    const added = await server.request('POST', '/api/admin/providers/mock/accounts', { vaid: SUPER, body: { name: 'a', credential: 'b' } });
    assert.equal(added.status, 400);

    await server.request('PUT', '/api/admin/providers/mock', { vaid: SUPER, body: { enabled: true } });
    assert.ok('provider' in (await resolveProvider('mock')));
  });

  it('đổi model có hiệu lực ngay, xóa model thì về mặc định', async () => {
    const before = effectiveModel('veo');
    const set = await server.request('PUT', '/api/admin/providers/veo', { vaid: SUPER, body: { model: 'veo-model-thu-nghiem' } });
    assert.equal(set.json.data.settings.effectiveModel, 'veo-model-thu-nghiem');
    assert.equal(effectiveModel('veo'), 'veo-model-thu-nghiem');
    await server.request('PUT', '/api/admin/providers/veo', { vaid: SUPER, body: { model: null } });
    assert.equal(effectiveModel('veo'), before);
  });

  it('kiểm tra đầu vào', async () => {
    const put = (body: unknown) => server.request('PUT', '/api/admin/providers/kling', { vaid: SUPER, body });
    assert.equal((await put({ baseUrl: 'http://api.example.com' })).status, 400);
    assert.equal((await put({ baseUrl: 'https://127.0.0.1' })).status, 400);
    assert.equal((await put({ baseUrl: 'https://192.168.1.5/x' })).status, 400);
    assert.equal((await put({ baseUrl: 'https://localhost' })).status, 400);
    assert.equal((await put({ baseUrl: 'https://user:pass@api.example.com' })).status, 400);
    assert.equal((await put({ baseUrl: 'khong-phai-url' })).status, 400);
    assert.equal((await put({ pricePerSecondUsd: -1 })).status, 400);
    assert.equal((await put({ pricePerSecondUsd: 'abc' })).status, 400);
    assert.equal((await put({ model: 'có dấu cách!' })).status, 400);
    assert.equal((await put({ notes: 'x'.repeat(501) })).status, 400);
    assert.equal((await put({ enabled: 'có' })).status, 400);
    assert.equal((await put({})).status, 400);
    const ok = await put({ baseUrl: 'https://api-singapore.klingai.com', pricePerSecondUsd: 0.07 });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.settings.pricePerSecondUsd, 0.07);
    assert.equal((await server.request('PUT', '/api/admin/providers/khong-co', { vaid: SUPER, body: { enabled: true } })).status, 404);
  });

  it('GET providers hiện mọi provider trong registry', async () => {
    const res = await server.request('GET', '/api/admin/providers', { vaid: SUPER });
    const ids = res.json.data.map((p: any) => p.id).sort();
    assert.deepEqual(ids, ['flow', 'kling', 'mock', 'veo']);
    for (const provider of res.json.data) {
      assert.ok(Array.isArray(provider.accounts));
      assert.ok('effectiveModel' in provider.settings);
    }
  });
});

describe('cài đặt hệ thống', () => {
  it('đọc, ghi, kiểm tra giá trị và ghi nhật ký trước/sau', async () => {
    assert.equal((await server.request('GET', '/api/admin/settings', { vaid: SUPER })).json.data.concurrencyLimit, 3);
    assert.equal((await server.request('PUT', '/api/admin/settings', { vaid: SUPER, body: { concurrencyLimit: 0 } })).status, 400);
    assert.equal((await server.request('PUT', '/api/admin/settings', { vaid: SUPER, body: { defaultProviderId: 'khong-co' } })).status, 400);
    assert.equal((await server.request('PUT', '/api/admin/settings', { vaid: SUPER, body: {} })).status, 400);
    const ok = await server.request('PUT', '/api/admin/settings', { vaid: SUPER, body: { concurrencyLimit: 8, maxRetries: 1 } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.concurrencyLimit, 8);
    const audit = await server.request('GET', '/api/admin/audit', { vaid: SUPER });
    const entry = audit.json.data.items[0];
    assert.equal(entry.action, 'settings.update');
    assert.equal(entry.actorVaid, SUPER);
    assert.deepEqual(entry.detail.before, { concurrencyLimit: 3, maxRetries: 2 });
    assert.deepEqual(entry.detail.after, { concurrencyLimit: 8, maxRetries: 1 });
  });
});

describe('AD-07: nhật ký', () => {
  it('mới nhất trước và phân trang bằng before', async () => {
    for (let i = 1; i <= 5; i++) {
      await server.request('PUT', '/api/admin/settings', { vaid: SUPER, body: { concurrencyLimit: i } });
    }
    const first = await server.request('GET', '/api/admin/audit?limit=2', { vaid: SUPER });
    assert.equal(first.json.data.items.length, 2);
    assert.ok(first.json.data.items[0].id > first.json.data.items[1].id);
    assert.ok(first.json.data.nextBefore);
    const second = await server.request('GET', `/api/admin/audit?limit=2&before=${first.json.data.nextBefore}`, { vaid: SUPER });
    assert.ok(second.json.data.items[0].id < first.json.data.items[1].id);
    const rest = await server.request('GET', `/api/admin/audit?limit=200&before=${second.json.data.nextBefore}`, { vaid: SUPER });
    assert.equal(rest.json.data.items.length, 1);
    assert.equal(rest.json.data.nextBefore, null);
    assert.equal((await server.request('GET', '/api/admin/audit?before=abc', { vaid: SUPER })).status, 400);
  });
});

describe('AD-06: thống kê', () => {
  async function seedJobs() {
    const now = new Date();
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
    const job = (id: string, providerId: string, status: string, extra: Record<string, unknown> = {}) => ({
      id, providerId, status, prompt: id, duration: 8, aspectRatio: '16:9', attempts: 0, ...extra,
    });
    const rows = [
      job('task_v0000001', 'veo', 'completed', { accountId: 1, startedAt: minutesAgo(10), finishedAt: minutesAgo(8) }),
      job('task_v0000002', 'veo', 'completed', { accountId: 1, startedAt: minutesAgo(20), finishedAt: minutesAgo(14), attempts: 1 }),
      job('task_v0000003', 'veo', 'failed', { accountId: 1, errorCode: 'CONTENT_FILTERED', errorMessage: 'bị lọc', finishedAt: minutesAgo(5), attempts: 2 }),
      job('task_k0000001', 'kling', 'completed', { duration: 5, accountId: 2, startedAt: minutesAgo(9), finishedAt: minutesAgo(8) }),
      job('task_k0000002', 'kling', 'failed', { accountId: 2, errorCode: 'CONTENT_FILTERED', errorMessage: 'bị lọc lần hai', finishedAt: minutesAgo(3) }),
      job('task_k0000003', 'kling', 'failed', { accountId: 2, errorCode: 'TIMEOUT', errorMessage: 'quá giờ', finishedAt: minutesAgo(2) }),
      job('task_m0000001', 'mock', 'pending', { createdAt: minutesAgo(90) }),
      job('task_m0000002', 'mock', 'running', { accountId: 3 }),
    ];
    for (const row of rows) {
      await db.execute(sql`
        INSERT INTO video_jobs (id, prompt, provider_id, status, duration, aspect_ratio, attempts, account_id, error_code, error_message, started_at, finished_at, created_at)
        VALUES (${row.id}, ${row.prompt}, ${row.providerId}, ${row.status}, ${row.duration}, ${row.aspectRatio}, ${row.attempts},
          ${(row as any).accountId ?? null}, ${(row as any).errorCode ?? null}, ${(row as any).errorMessage ?? null},
          ${(row as any).startedAt ?? null}, ${(row as any).finishedAt ?? null}, ${(row as any).createdAt ?? now})
      `);
    }
  }

  it('khớp với đếm tay trên bộ job mẫu', async () => {
    await seedJobs();
    await server.request('PUT', '/api/admin/providers/veo', { vaid: SUPER, body: { pricePerSecondUsd: 0.5 } });
    const res = await server.request('GET', '/api/admin/stats', { vaid: SUPER });
    assert.equal(res.status, 200);
    const data = res.json.data;

    assert.deepEqual(data.totals, { jobs: 8, completed: 3, failed: 3, stopped: 0, pending: 1, running: 1, successRate: 0.5 });
    assert.equal(data.range.to, todayInVietnam());
    assert.equal(data.perDay.length, 30);
    const today = data.perDay[data.perDay.length - 1];
    assert.equal(today.date, todayInVietnam());
    assert.equal(today.created + (data.perDay.slice(0, -1).reduce((s: number, d: any) => s + d.created, 0)), 8);

    const veo = data.perProvider.find((p: any) => p.providerId === 'veo');
    assert.equal(veo.jobs, 3);
    assert.equal(veo.completed, 2);
    assert.equal(veo.failed, 1);
    assert.ok(Math.abs(veo.successRate - 2 / 3) < 1e-9);
    assert.equal(veo.videoSeconds, 16);
    assert.equal(veo.estimatedCostUsd, 8);
    assert.ok(Math.abs(veo.avgCompleteSeconds - 240) < 1);
    assert.ok(veo.p95CompleteSeconds > 240 && veo.p95CompleteSeconds <= 360);

    const kling = data.perProvider.find((p: any) => p.providerId === 'kling');
    assert.equal(kling.videoSeconds, 5);
    assert.equal(kling.estimatedCostUsd, null);
    assert.equal(kling.successRate, 1 / 3);

    const flow = data.perProvider.find((p: any) => p.providerId === 'flow');
    assert.equal(flow.jobs, 0);
    assert.equal(flow.successRate, null);
    assert.equal(flow.avgCompleteSeconds, null);

    assert.deepEqual(data.perAccount.map((a: any) => [a.accountId, a.jobs, a.completed, a.failed]), [[1, 3, 2, 1], [2, 3, 1, 2], [3, 1, 0, 0]]);
    assert.deepEqual(data.topErrors.map((e: any) => [e.errorCode, e.count]), [['CONTENT_FILTERED', 2], ['TIMEOUT', 1]]);
    assert.equal(data.topErrors[0].lastMessage, 'bị lọc lần hai');
    assert.equal(data.queue.pending, 1);
    assert.equal(data.queue.running, 1);
    assert.ok(data.queue.oldestPendingAgeSeconds >= 89 * 60);
    assert.deepEqual(data.retries, { jobsWithRetry: 2, totalExtraAttempts: 3 });
  });

  it('chưa có mẫu thì tỉ lệ thành công là null', async () => {
    const data = (await server.request('GET', '/api/admin/stats', { vaid: SUPER })).json.data;
    assert.equal(data.totals.jobs, 0);
    assert.equal(data.totals.successRate, null);
    assert.equal(data.queue.oldestPendingAgeSeconds, null);
    assert.deepEqual(data.topErrors, []);
  });

  it('kiểm tra khoảng ngày', async () => {
    const get = (qs: string) => server.request('GET', `/api/admin/stats?${qs}`, { vaid: SUPER });
    assert.equal((await get('from=2026-01-01&to=2027-01-01')).status, 400);
    assert.equal((await get('from=2026-01-01&to=2026-12-31')).status, 200);
    assert.equal((await get('from=2026-02-30&to=2026-03-01')).status, 400);
    assert.equal((await get('from=hom-qua&to=2026-03-01')).status, 400);
    assert.equal((await get('from=2026-03-05&to=2026-03-01')).status, 400);
    const one = await get('from=2026-03-01&to=2026-03-01');
    assert.equal(one.json.data.perDay.length, 1);
  });
});
