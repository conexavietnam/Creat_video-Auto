import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { accounts, appSettings, refImages, studioCards, videoJobs } from '../db/schema.ts';
import { decryptCredential } from './crypto.ts';
import { decodeImage } from './images.ts';
import { getProvider, ImageInput, ProviderError, VideoSource } from './providers/index.ts';
import { makeThumbnail, saveVideo } from './storage.ts';

type JobRow = typeof videoJobs.$inferSelect;
type AccountRow = typeof accounts.$inferSelect;

interface Failure {
  code: string;
  message: string;
  retryable: boolean;
}

const TICK_MS = 2000;
const HEALTH_MS = 60000;
const HEALTH_TIMEOUT_MS = 15000;
const RATE_LIMIT_COOLDOWN_MS = 60000;
const MAX_DOWNLOAD_FAILURES = 3;

let paused = false;
let ticking = false;
let sweeping = false;
let tickTimer: NodeJS.Timeout | null = null;
let healthTimer: NodeJS.Timeout | null = null;

const submitting = new Set<string>();
const lastPolled = new Map<string, number>();
const signatures = new Map<string, string>();
const downloadFailures = new Map<string, number>();

function forget(jobId: string) {
  submitting.delete(jobId);
  lastPolled.delete(jobId);
  signatures.delete(jobId);
  downloadFailures.delete(jobId);
}

export async function getSettings() {
  const rows = await db.select().from(appSettings).where(eq(appSettings.id, 1));
  return (
    rows[0] || {
      id: 1,
      concurrencyLimit: 3,
      maxRetries: 2,
      timeoutMinutes: 15,
      autoEnqueueOnPaste: true,
      defaultDuration: 10,
      defaultAspectRatio: '9:16',
      defaultProviderId: 'auto',
      updatedAt: new Date(),
    }
  );
}

export function isDispatcherActive() {
  return !paused;
}

export function isAccountSchedulable(account: AccountRow, now = Date.now()): boolean {
  if (!account.isEnabled || account.sessionStatus !== 'online') return false;
  if (account.cooldownUntil && account.cooldownUntil.getTime() > now) return false;
  const provider = getProvider(account.providerId);
  return !!provider && provider.available;
}

export function computeEffectiveConcurrency(concurrencyLimit: number, allAccounts: AccountRow[]) {
  const slots = allAccounts.filter(a => isAccountSchedulable(a)).reduce((sum, a) => sum + Math.max(1, a.maxSlots), 0);
  return Math.min(concurrencyLimit, slots);
}

async function syncStudio(jobId: string, status: 'idle' | 'generating' | 'completed' | 'failed', videoUrl?: string) {
  await db
    .update(studioCards)
    .set(videoUrl ? { status, videoUrl } : { status })
    .where(eq(studioCards.jobId, jobId));
}

async function cancelRemote(job: JobRow, account?: AccountRow) {
  if (!job.externalId) return;
  const provider = getProvider(job.providerId);
  if (!provider) return;
  try {
    const owner = account || (job.accountId ? (await db.select().from(accounts).where(eq(accounts.id, job.accountId)))[0] : undefined);
    if (!owner) return;
    await provider.cancel(decryptCredential(owner.encryptedCredential), job.externalId);
  } catch {
    return;
  }
}

async function failOrRetry(job: JobRow, failure: Failure) {
  const settings = await getSettings();
  const now = new Date();
  const elapsed = job.startedAt ? Math.floor((now.getTime() - job.startedAt.getTime()) / 1000) : job.elapsedSeconds;
  forget(job.id);

  if (failure.retryable && job.attempts < settings.maxRetries) {
    const attempt = job.attempts + 1;
    await db
      .update(videoJobs)
      .set({
        status: 'pending',
        progress: 0,
        attempts: attempt,
        accountId: null,
        externalId: null,
        startedAt: null,
        lastProgressAt: null,
        elapsedSeconds: 0,
        errorCode: failure.code,
        errorMessage: `Lần thử ${attempt}/${settings.maxRetries} thất bại: ${failure.message}`,
      })
      .where(and(eq(videoJobs.id, job.id), eq(videoJobs.status, 'running')));
    return;
  }

  const exhausted = failure.retryable && settings.maxRetries > 0;
  await db
    .update(videoJobs)
    .set({
      status: 'failed',
      progress: 0,
      finishedAt: now,
      elapsedSeconds: elapsed,
      errorCode: failure.code,
      errorMessage: exhausted ? `Đã thử lại ${job.attempts} lần vẫn thất bại: ${failure.message}` : failure.message,
    })
    .where(and(eq(videoJobs.id, job.id), eq(videoJobs.status, 'running')));
  await syncStudio(job.id, 'failed');
}

async function releaseAccountJobs(accountId: number, code: string, message: string) {
  const affected = await db
    .select()
    .from(videoJobs)
    .where(and(eq(videoJobs.accountId, accountId), eq(videoJobs.status, 'running')));
  for (const job of affected) {
    await cancelRemote(job);
    forget(job.id);
    await db
      .update(videoJobs)
      .set({
        status: 'pending',
        progress: 0,
        accountId: null,
        externalId: null,
        startedAt: null,
        lastProgressAt: null,
        elapsedSeconds: 0,
        errorCode: code,
        errorMessage: message,
      })
      .where(and(eq(videoJobs.id, job.id), eq(videoJobs.status, 'running')));
  }
}

export async function disableAccountJobs(accountId: number, code: string, message: string) {
  await releaseAccountJobs(accountId, code, message);
}

async function markAccountOffline(accountId: number, reason: string) {
  await db
    .update(accounts)
    .set({ sessionStatus: 'offline', healthReason: reason, lastHealthCheck: new Date() })
    .where(eq(accounts.id, accountId));
  await releaseAccountJobs(
    accountId,
    'ACCOUNT_DISCONNECTED',
    'Tài khoản mất kết nối giữa chừng, job được chuyển về Chờ để gán tài khoản Online khác',
  );
}

export async function checkAccountHealth(account: AccountRow): Promise<{ ok: boolean; reason: string }> {
  const provider = getProvider(account.providerId);
  let result: { ok: boolean; reason: string };
  if (!provider) {
    result = { ok: false, reason: 'Nền tảng của tài khoản không còn được hỗ trợ' };
  } else if (!provider.available) {
    result = { ok: false, reason: provider.unavailableReason || 'Nền tảng chưa khả dụng' };
  } else {
    try {
      const credential = decryptCredential(account.encryptedCredential);
      result = await Promise.race([
        provider.health(credential),
        new Promise<{ ok: boolean; reason: string }>(resolve =>
          setTimeout(() => resolve({ ok: false, reason: 'Kiểm tra sức khỏe phiên quá thời gian chờ' }), HEALTH_TIMEOUT_MS),
        ),
      ]);
    } catch {
      result = { ok: false, reason: 'Không giải mã được credential đã lưu, vui lòng thêm lại tài khoản' };
    }
  }

  await db
    .update(accounts)
    .set({
      lastHealthCheck: new Date(),
      sessionStatus: result.ok && account.isEnabled ? 'online' : 'offline',
      healthReason: result.reason,
    })
    .where(eq(accounts.id, account.id));

  if (!result.ok) {
    await releaseAccountJobs(
      account.id,
      'ACCOUNT_DISCONNECTED',
      'Tài khoản mất kết nối giữa chừng, job được chuyển về Chờ để gán tài khoản Online khác',
    );
  }
  return result;
}

async function healthSweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    const list = await db.select().from(accounts).where(eq(accounts.isEnabled, true));
    for (const account of list) {
      await checkAccountHealth(account);
    }
  } catch (err) {
    console.error('Lỗi health check:', err);
  } finally {
    sweeping = false;
  }
}

async function materialize(jobId: string, video: VideoSource): Promise<{ videoUrl: string; thumbnailUrl: string | null }> {
  if (video.remoteOnly) {
    return { videoUrl: video.url, thumbnailUrl: null };
  }
  const res = await fetch(video.url, { headers: video.headers });
  if (!res.ok) {
    throw new Error(`Tải video từ nền tảng thất bại (HTTP ${res.status})`);
  }
  const videoUrl = await saveVideo(jobId, Buffer.from(await res.arrayBuffer()));
  return { videoUrl, thumbnailUrl: await makeThumbnail(jobId) };
}

async function finishJob(job: JobRow, video: VideoSource) {
  try {
    const stored = await materialize(job.id, video);
    const now = new Date();
    forget(job.id);
    await db
      .update(videoJobs)
      .set({
        status: 'completed',
        progress: 100,
        finishedAt: now,
        elapsedSeconds: job.startedAt ? Math.floor((now.getTime() - job.startedAt.getTime()) / 1000) : job.elapsedSeconds,
        videoUrl: stored.videoUrl,
        thumbnailUrl: stored.thumbnailUrl,
        errorCode: null,
        errorMessage: null,
      })
      .where(and(eq(videoJobs.id, job.id), eq(videoJobs.status, 'running')));
    await syncStudio(job.id, 'completed', stored.videoUrl);
  } catch (err: any) {
    const failures = (downloadFailures.get(job.id) || 0) + 1;
    downloadFailures.set(job.id, failures);
    if (failures >= MAX_DOWNLOAD_FAILURES) {
      await failOrRetry(job, {
        code: 'DOWNLOAD_FAILED',
        message: `Không tải được video đã tạo: ${err?.message || 'lỗi không xác định'}`,
        retryable: false,
      });
    }
  }
}

async function handleProviderError(job: JobRow, account: AccountRow, err: unknown) {
  const failure: Failure =
    err instanceof ProviderError
      ? { code: err.code, message: err.message, retryable: err.retryable }
      : { code: 'PROVIDER_ERROR', message: `Lỗi không xác định từ nền tảng: ${String((err as any)?.message || err).slice(0, 200)}`, retryable: true };

  if (failure.code === 'AUTH_FAILED') {
    await markAccountOffline(account.id, failure.message);
    return;
  }
  if (failure.code === 'RATE_LIMITED') {
    await db
      .update(accounts)
      .set({ cooldownUntil: new Date(Date.now() + RATE_LIMIT_COOLDOWN_MS) })
      .where(eq(accounts.id, account.id));
  }
  await failOrRetry(job, failure);
}

async function loadImages(job: JobRow): Promise<{ refs: ImageInput[]; input?: ImageInput } | Failure> {
  const snapshot: Array<{ tag: string; imageId: number }> = JSON.parse(job.refSnapshot || '[]');
  const refs: ImageInput[] = [];
  if (snapshot.length > 0) {
    const rows = await db.select().from(refImages).where(inArray(refImages.id, snapshot.map(s => s.imageId)));
    for (const item of snapshot) {
      const row = rows.find(r => r.id === item.imageId);
      const decoded = row ? decodeImage(row.dataUrl) : null;
      if (!row || !decoded) {
        return {
          code: 'REF_MISSING',
          message: `Ảnh tham chiếu @${item.tag} đã bị xóa khỏi kho nên không thể chạy job này`,
          retryable: false,
        };
      }
      refs.push({ tag: item.tag, bytes: decoded.bytes, mimeType: decoded.mimeType });
    }
  }
  let input: ImageInput | undefined;
  if (job.inputImageUrl) {
    const decoded = decodeImage(job.inputImageUrl);
    if (!decoded) {
      return { code: 'INPUT_IMAGE_INVALID', message: 'Ảnh đầu vào của thẻ Studio không đọc được', retryable: false };
    }
    input = { bytes: decoded.bytes, mimeType: decoded.mimeType };
  }
  return { refs, input };
}

async function startJob(job: JobRow, account: AccountRow) {
  submitting.add(job.id);
  try {
    const provider = getProvider(job.providerId);
    if (!provider || !provider.available) {
      await failOrRetry(job, {
        code: 'PROVIDER_UNAVAILABLE',
        message: provider?.unavailableReason || 'Nền tảng của job không còn được hỗ trợ',
        retryable: false,
      });
      return;
    }
    const images = await loadImages(job);
    if ('code' in images) {
      await failOrRetry(job, images);
      return;
    }
    const submission = {
      jobId: job.id,
      prompt: job.prompt,
      duration: job.duration,
      aspectRatio: job.aspectRatio,
      refImages: images.refs,
      inputImage: images.input,
    };
    const invalid = provider.validate(submission);
    if (invalid) {
      await failOrRetry(job, { code: 'INVALID_REQUEST', message: invalid, retryable: false });
      return;
    }
    const credential = decryptCredential(account.encryptedCredential);
    const { externalId } = await provider.submit(credential, submission);
    const now = new Date();
    lastPolled.set(job.id, Date.now());
    await db
      .update(videoJobs)
      .set({ externalId, lastProgressAt: now, progress: 5 })
      .where(and(eq(videoJobs.id, job.id), eq(videoJobs.status, 'running')));
  } catch (err) {
    await handleProviderError(job, account, err);
  } finally {
    submitting.delete(job.id);
  }
}

async function pollJob(job: JobRow, timeoutMinutes: number) {
  if (submitting.has(job.id)) return;
  const now = Date.now();
  const anchor = (job.lastProgressAt || job.startedAt)?.getTime() ?? now;

  if (now - anchor > timeoutMinutes * 60000) {
    await cancelRemote(job);
    await failOrRetry(job, {
      code: 'TIMEOUT',
      message: `Job không có tiến độ mới quá ${timeoutMinutes} phút nên bị đánh dấu timeout`,
      retryable: true,
    });
    return;
  }

  const elapsed = job.startedAt ? Math.floor((now - job.startedAt.getTime()) / 1000) : job.elapsedSeconds;
  const provider = getProvider(job.providerId);
  if (!job.externalId || !provider) {
    await db.update(videoJobs).set({ elapsedSeconds: elapsed }).where(eq(videoJobs.id, job.id));
    return;
  }
  if (now - (lastPolled.get(job.id) || 0) < provider.pollIntervalMs) {
    await db.update(videoJobs).set({ elapsedSeconds: elapsed }).where(eq(videoJobs.id, job.id));
    return;
  }
  lastPolled.set(job.id, now);

  const account = job.accountId ? (await db.select().from(accounts).where(eq(accounts.id, job.accountId)))[0] : undefined;
  if (!account) {
    forget(job.id);
    await db
      .update(videoJobs)
      .set({
        status: 'pending',
        progress: 0,
        accountId: null,
        externalId: null,
        startedAt: null,
        lastProgressAt: null,
        elapsedSeconds: 0,
        errorCode: 'ACCOUNT_REMOVED',
        errorMessage: 'Tài khoản không còn trong pool, job được chuyển về Chờ để gán tài khoản khác',
      })
      .where(and(eq(videoJobs.id, job.id), eq(videoJobs.status, 'running')));
    return;
  }

  try {
    const result = await provider.poll(decryptCredential(account.encryptedCredential), job.externalId);
    if (result.state === 'done') {
      await finishJob(job, result.video);
      return;
    }
    if (result.state === 'failed') {
      await failOrRetry(job, { code: result.code, message: result.message, retryable: result.retryable });
      return;
    }
    const signature = `${result.progress ?? ''}|${result.stage ?? ''}`;
    const changed = signatures.get(job.id) !== signature;
    signatures.set(job.id, signature);
    await db
      .update(videoJobs)
      .set({
        elapsedSeconds: elapsed,
        ...(result.progress !== undefined ? { progress: Math.min(99, result.progress) } : {}),
        ...(changed ? { lastProgressAt: new Date() } : {}),
      })
      .where(and(eq(videoJobs.id, job.id), eq(videoJobs.status, 'running')));
  } catch (err) {
    await handleProviderError(job, account, err);
  }
}

async function assignPending(): Promise<Array<{ job: JobRow; account: AccountRow }>> {
  const settings = await getSettings();
  const allAccounts = await db.select().from(accounts);
  const schedulable = allAccounts.filter(a => isAccountSchedulable(a));
  if (schedulable.length === 0) return [];

  const effective = computeEffectiveConcurrency(settings.concurrencyLimit, allAccounts);

  return db.transaction(async tx => {
    const running = await tx.select().from(videoJobs).where(eq(videoJobs.status, 'running'));
    const load = new Map<number, number>();
    for (const job of running) {
      if (job.accountId) load.set(job.accountId, (load.get(job.accountId) || 0) + 1);
    }
    let globalFree = effective - running.length;
    if (globalFree <= 0) return [];

    const pending = await tx
      .select()
      .from(videoJobs)
      .where(eq(videoJobs.status, 'pending'))
      .orderBy(asc(videoJobs.createdAt))
      .for('update', { skipLocked: true });

    const assignments: Array<{ job: JobRow; account: AccountRow }> = [];
    for (const job of pending) {
      if (globalFree <= 0) break;
      const candidates = schedulable
        .filter(a => a.providerId === job.providerId && (load.get(a.id) || 0) < Math.max(1, a.maxSlots))
        .sort((a, b) => (load.get(a.id) || 0) - (load.get(b.id) || 0));
      const account = candidates[0];
      if (!account) continue;

      const now = new Date();
      await tx
        .update(videoJobs)
        .set({ status: 'running', accountId: account.id, startedAt: now, lastProgressAt: now, progress: 5, elapsedSeconds: 0 })
        .where(eq(videoJobs.id, job.id));
      load.set(account.id, (load.get(account.id) || 0) + 1);
      globalFree -= 1;
      assignments.push({ job: { ...job, status: 'running', accountId: account.id, startedAt: now }, account });
    }
    return assignments;
  });
}

async function syncAccountCounters() {
  await db.execute(sql`
    UPDATE accounts a SET current_running_jobs = (
      SELECT COUNT(*) FROM video_jobs j WHERE j.account_id = a.id AND j.status = 'running'
    )
  `);
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const settings = await getSettings();
    const running = await db.select().from(videoJobs).where(eq(videoJobs.status, 'running'));
    await Promise.all(running.map(job => pollJob(job, settings.timeoutMinutes)));

    if (!paused) {
      const assignments = await assignPending();
      await Promise.all(assignments.map(({ job, account }) => startJob(job, account)));
    }
    await syncAccountCounters();
  } catch (err) {
    console.error('Lỗi dispatcher:', err);
  } finally {
    ticking = false;
  }
}

export function startDispatcher() {
  if (tickTimer) return;
  tickTimer = setInterval(tick, TICK_MS);
  healthTimer = setInterval(healthSweep, HEALTH_MS);
  void healthSweep();
}

export function resumeDispatcher() {
  paused = false;
}

export async function stopAll() {
  paused = true;
  const running = await db.select().from(videoJobs).where(eq(videoJobs.status, 'running'));
  for (const job of running) {
    await cancelRemote(job);
    forget(job.id);
    await db
      .update(videoJobs)
      .set({ status: 'stopped', finishedAt: new Date(), errorCode: null, errorMessage: null })
      .where(and(eq(videoJobs.id, job.id), eq(videoJobs.status, 'running')));
    await syncStudio(job.id, 'idle');
  }
  await syncAccountCounters();
}

export async function cancelJobRemote(job: JobRow) {
  await cancelRemote(job);
  forget(job.id);
}
