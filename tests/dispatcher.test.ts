import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, it } from 'node:test';
import { closeDatabase, db, resetDatabase } from './helpers.ts';

const { eq } = await import('drizzle-orm');
const { accounts, videoJobs } = await import('../src/db/schema.ts');
const { encryptCredential } = await import('../src/server/crypto.ts');
const dispatcher = await import('../src/server/dispatcher.ts');
const { mockProvider } = await import('../src/server/providers/mock.ts');
const { ProviderError } = await import('../src/server/providers/types.ts');

const original = {
  health: mockProvider.health,
  poll: mockProvider.poll,
  submit: mockProvider.submit,
  pollIntervalMs: mockProvider.pollIntervalMs,
};

let submitCalls: string[] = [];

beforeEach(async () => {
  await resetDatabase();
  dispatcher.resetDispatcherState();
  submitCalls = [];
  mockProvider.pollIntervalMs = 0;
  mockProvider.poll = async () => ({ state: 'running', stage: 'processing' });
  mockProvider.submit = async (credential, input) => {
    submitCalls.push(`${credential}:${input.jobId}`);
    return { externalId: `mock:${Date.now()}:5:run` };
  };
  mockProvider.health = async () => ({ ok: true, reason: 'Phiên mô phỏng hoạt động bình thường' });
});

afterEach(() => {
  mockProvider.health = original.health;
  mockProvider.poll = original.poll;
  mockProvider.submit = original.submit;
  mockProvider.pollIntervalMs = original.pollIntervalMs;
  dispatcher.shutdownDispatcher();
});

after(async () => {
  await closeDatabase();
});

async function addAccount(name: string, credential = `cred-${name}`) {
  const rows = await db
    .insert(accounts)
    .values({
      name,
      maskedIdentifier: `usr_***${name}`,
      encryptedCredential: encryptCredential(credential),
      providerId: 'mock',
      sessionStatus: 'online',
      maxSlots: 1,
    })
    .returning();
  return rows[0];
}

async function addJob(id: string, fields: Partial<typeof videoJobs.$inferInsert> = {}) {
  const now = new Date();
  await db.insert(videoJobs).values({
    id,
    prompt: id,
    providerId: 'mock',
    status: 'running',
    duration: 5,
    aspectRatio: '9:16',
    startedAt: now,
    lastProgressAt: now,
    ...fields,
  });
}

const getJob = async (id: string) => (await db.select().from(videoJobs).where(eq(videoJobs.id, id)))[0];
const getAccount = async (id: number) => (await db.select().from(accounts).where(eq(accounts.id, id)))[0];

const transientFailure = { ok: false, reason: 'Kiểm tra sức khỏe phiên quá thời gian chờ', code: 'TIMEOUT' };

describe('W1-A: health check không đá tài khoản vì lỗi thoáng qua', () => {
  it('một lần health lỗi không làm tài khoản Offline và không giải phóng job đang chạy', async () => {
    const account = await addAccount('a1');
    await addJob('task_run00001', { accountId: account.id, externalId: 'mock:1:5:run' });
    mockProvider.health = async () => transientFailure;

    const result = await dispatcher.checkAccountHealth(await getAccount(account.id), { auto: true });
    assert.equal(result.ok, false);

    const after = await getAccount(account.id);
    assert.equal(after.sessionStatus, 'online');
    assert.match(after.healthReason ?? '', /lần 1\/3/);
    const job = await getJob('task_run00001');
    assert.equal(job.status, 'running');
    assert.equal(job.accountId, account.id);
    assert.equal(job.externalId, 'mock:1:5:run');
    assert.equal(job.attempts, 0);
  });

  it('chỉ Offline khi lỗi 3 lần liên tiếp, và lúc đó mới giải phóng job', async () => {
    const account = await addAccount('a1');
    await addJob('task_run00001', { accountId: account.id, externalId: 'mock:1:5:run' });
    mockProvider.health = async () => transientFailure;

    for (let i = 1; i <= 2; i++) {
      await dispatcher.checkAccountHealth(await getAccount(account.id), { auto: true });
      assert.equal((await getAccount(account.id)).sessionStatus, 'online', `sau lần ${i} vẫn Online`);
      assert.equal((await getJob('task_run00001')).status, 'running');
    }
    await dispatcher.checkAccountHealth(await getAccount(account.id), { auto: true });
    const after = await getAccount(account.id);
    assert.equal(after.sessionStatus, 'offline');
    assert.match(after.healthReason ?? '', /3 lần liên tiếp/);
    const job = await getJob('task_run00001');
    assert.equal(job.status, 'pending');
    assert.equal(job.accountId, null);
    assert.equal(job.attempts, 0);
  });

  it('một lần health thành công xóa bộ đếm lỗi', async () => {
    const account = await addAccount('a1');
    for (const ok of [false, false, true, false, false]) {
      mockProvider.health = async () => (ok ? { ok: true, reason: 'ổn' } : transientFailure);
      await dispatcher.checkAccountHealth(await getAccount(account.id), { auto: true });
    }
    assert.equal((await getAccount(account.id)).sessionStatus, 'online');
  });

  it('AUTH_FAILED thì Offline ngay lập tức', async () => {
    const account = await addAccount('a1');
    await addJob('task_run00001', { accountId: account.id, externalId: 'mock:1:5:run' });
    mockProvider.health = async () => ({ ok: false, reason: 'Khóa bị từ chối', code: 'AUTH_FAILED' });

    await dispatcher.checkAccountHealth(await getAccount(account.id), { auto: true });
    assert.equal((await getAccount(account.id)).sessionStatus, 'offline');
    assert.equal((await getJob('task_run00001')).status, 'pending');
  });

  it('tài khoản đang Offline do lỗi tạm thời tự trở lại Online khi health ổn', async () => {
    const account = await addAccount('a1');
    mockProvider.health = async () => transientFailure;
    for (let i = 0; i < 3; i++) await dispatcher.checkAccountHealth(await getAccount(account.id), { auto: true });
    assert.equal((await getAccount(account.id)).sessionStatus, 'offline');
    mockProvider.health = async () => ({ ok: true, reason: 'ổn' });
    await dispatcher.checkAccountHealth(await getAccount(account.id), { auto: true });
    assert.equal((await getAccount(account.id)).sessionStatus, 'online');
  });
});

describe('W1-A: poll lỗi tạm thời không làm job bị gửi lại', () => {
  const networkError = new ProviderError('PROVIDER_ERROR', 'Không kết nối được nền tảng', true);

  it('lỗi mạng khi poll giữ nguyên job, không gửi lại, không tốn lần retry', async () => {
    const account = await addAccount('a1');
    await addJob('task_run00001', { accountId: account.id, externalId: 'mock:1:5:run' });
    mockProvider.poll = async () => {
      throw networkError;
    };

    for (let i = 0; i < 4; i++) await dispatcher.tickOnce();
    const job = await getJob('task_run00001');
    assert.equal(job.status, 'running');
    assert.equal(job.externalId, 'mock:1:5:run');
    assert.equal(job.accountId, account.id);
    assert.equal(job.attempts, 0);
    assert.deepEqual(submitCalls, []);
  });

  it('429 và JSON hỏng khi poll cũng được coi là tạm thời', async () => {
    const account = await addAccount('a1');
    await addJob('task_run00001', { accountId: account.id, externalId: 'mock:1:5:run' });
    const errors = [new ProviderError('RATE_LIMITED', '429', true), new ProviderError('INVALID_REQUEST', 'không phải JSON', false), new Error('fetch failed')];
    let i = 0;
    mockProvider.poll = async () => {
      throw errors[i++ % errors.length];
    };
    for (let n = 0; n < 6; n++) await dispatcher.tickOnce();
    assert.equal((await getJob('task_run00001')).status, 'running');
    assert.deepEqual(submitCalls, []);
  });

  it('chỉ sau 10 lần lỗi liên tiếp mới coi là PROVIDER_ERROR và xếp lại (tính 1 lần retry)', async () => {
    const account = await addAccount('a1');
    await addJob('task_run00001', { accountId: account.id, externalId: 'mock:1:5:run' });
    mockProvider.poll = async () => {
      throw networkError;
    };

    for (let i = 1; i <= 9; i++) {
      await dispatcher.tickOnce();
      assert.equal((await getJob('task_run00001')).status, 'running', `sau ${i} lần lỗi vẫn đang chạy`);
    }
    assert.deepEqual(submitCalls, [], 'trước ngưỡng không có lần gửi lại nào');
    await dispatcher.tickOnce();
    const job = await getJob('task_run00001');
    assert.equal(job.attempts, 1);
    assert.equal(job.errorCode, 'PROVIDER_ERROR');
    assert.match(job.errorMessage ?? '', /10 lần/);
    assert.equal(submitCalls.length, 1, 'chỉ sau ngưỡng job mới được gửi lại, đúng 1 lần');
  });

  it('một lần poll thành công xóa bộ đếm lỗi', async () => {
    const account = await addAccount('a1');
    await addJob('task_run00001', { accountId: account.id, externalId: 'mock:1:5:run' });
    let calls = 0;
    mockProvider.poll = async () => {
      calls += 1;
      if (calls === 10) return { state: 'running', stage: 'processing' };
      throw networkError;
    };
    for (let i = 0; i < 18; i++) await dispatcher.tickOnce();
    assert.equal((await getJob('task_run00001')).status, 'running');
  });

  it('AUTH_FAILED khi poll: job kết thúc với cảnh báo, không gửi lại, tài khoản Offline', async () => {
    const account = await addAccount('a1');
    await addJob('task_run00001', { accountId: account.id, externalId: 'mock:1:5:run' });
    mockProvider.poll = async () => {
      throw new ProviderError('AUTH_FAILED', 'Khóa không hợp lệ', false);
    };

    await dispatcher.tickOnce();
    const job = await getJob('task_run00001');
    assert.equal(job.status, 'failed');
    assert.equal(job.errorCode, 'AUTH_FAILED');
    assert.match(job.errorMessage ?? '', /đã được tạo và tính phí/);
    assert.equal((await getAccount(account.id)).sessionStatus, 'offline');
    assert.deepEqual(submitCalls, []);
  });
});

describe('W1-A: khôi phục khi khởi động', () => {
  it('job running chưa có external_id được xếp lại ngay, không tính retry; job có external_id giữ nguyên', async () => {
    const account = await addAccount('a1');
    await addJob('task_half0001', { accountId: account.id, externalId: null, attempts: 1 });
    await addJob('task_live0001', { accountId: account.id, externalId: 'mock:1:5:run' });

    await dispatcher.recoverInterruptedJobs();
    const half = await getJob('task_half0001');
    assert.equal(half.status, 'pending');
    assert.equal(half.accountId, null);
    assert.equal(half.attempts, 1);
    assert.equal(half.errorCode, 'SERVER_RESTART');
    const live = await getJob('task_live0001');
    assert.equal(live.status, 'running');
    assert.equal(live.externalId, 'mock:1:5:run');
  });

  it('startDispatcher tự gọi bước khôi phục', async () => {
    const account = await addAccount('a1');
    await addJob('task_half0001', { accountId: account.id, externalId: null });
    dispatcher.startDispatcher();
    for (let i = 0; i < 40; i++) {
      if ((await getJob('task_half0001')).status === 'pending') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal((await getJob('task_half0001')).status, 'pending');
  });
});

describe('W1-A 4b: hết hạn mức Veo không xoay vòng vô ích', () => {
  const quotaError = new ProviderError('QUOTA_EXHAUSTED', 'Dự án Google của khóa này chưa có hạn mức Veo, kiểm tra đã bật thanh toán chưa (Google: 429 RESOURCE_EXHAUSTED)', false);

  it('job thất bại ngay không retry, tài khoản vào cooldown kèm lý do, job sau chỉ đi khóa còn lại', async () => {
    const bad = await addAccount('bad', 'khoa-het-han-muc');
    const good = await addAccount('good', 'khoa-tot');
    mockProvider.submit = async (credential, input) => {
      submitCalls.push(`${credential}:${input.jobId}`);
      if (credential === 'khoa-het-han-muc') throw quotaError;
      return { externalId: `mock:${Date.now()}:5:run` };
    };
    await addJob('task_pend0001', { status: 'pending', startedAt: null, lastProgressAt: null });
    await addJob('task_pend0002', { status: 'pending', startedAt: null, lastProgressAt: null });

    await dispatcher.tickOnce();
    const jobs = [await getJob('task_pend0001'), await getJob('task_pend0002')];
    const failed = jobs.find(j => j.accountId === bad.id)!;
    const running = jobs.find(j => j.accountId === good.id)!;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.errorCode, 'QUOTA_EXHAUSTED');
    assert.equal(failed.attempts, 0);
    assert.match(failed.errorMessage ?? '', /bật thanh toán/);
    assert.equal(running.status, 'running');

    const badAfter = await getAccount(bad.id);
    assert.ok(badAfter.cooldownUntil && badAfter.cooldownUntil.getTime() > Date.now() + 20 * 60_000);
    assert.match(badAfter.healthReason ?? '', /^Hết hạn mức: /);
    assert.equal(badAfter.sessionStatus, 'online');

    await addJob('task_pend0003', { status: 'pending', startedAt: null, lastProgressAt: null });
    await db.update(videoJobs).set({ status: 'completed' }).where(eq(videoJobs.id, running.id));
    await dispatcher.tickOnce();
    assert.equal((await getJob('task_pend0003')).accountId, good.id);
    assert.equal(submitCalls.filter(c => c.startsWith('khoa-het-han-muc')).length, 1);
  });

  it('health tự động giữ nguyên cảnh báo; bấm Kiểm tra thủ công thì gỡ cooldown', async () => {
    const account = await addAccount('bad');
    await db
      .update(accounts)
      .set({ cooldownUntil: new Date(Date.now() + 25 * 60_000), healthReason: 'Hết hạn mức: Dự án Google chưa có hạn mức Veo' })
      .where(eq(accounts.id, account.id));

    await dispatcher.checkAccountHealth(await getAccount(account.id), { auto: true });
    const kept = await getAccount(account.id);
    assert.match(kept.healthReason ?? '', /^Hết hạn mức: /);
    assert.ok(kept.cooldownUntil);

    await dispatcher.checkAccountHealth(await getAccount(account.id));
    const cleared = await getAccount(account.id);
    assert.equal(cleared.cooldownUntil, null);
    assert.doesNotMatch(cleared.healthReason ?? '', /^Hết hạn mức/);
  });
});
