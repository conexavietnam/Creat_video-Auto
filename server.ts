import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './src/db/index.ts';
import { accounts, refImages, videoJobs, studioCards, appSettings, projectProgress } from './src/db/schema.ts';
import { eq, desc, sql, like, or, and, ilike, getTableColumns } from 'drizzle-orm';
import { migrate } from './src/server/migrate.ts';
import { encryptCredential, maskIdentifier } from './src/server/crypto.ts';
import { isAuthRequired, isAuthenticated, login, logout, requireAuth } from './src/server/auth.ts';
import { decodeImage, extractTags, MAX_IMAGE_BYTES, normalizeTag } from './src/server/images.ts';
import { VIDEO_DIR, removeVideoFiles } from './src/server/storage.ts';
import { getProvider, listProviders, publicProvider } from './src/server/providers/index.ts';
import { checkCapabilities, generateTaskId, resolveProvider, resolveTags, splitPrompts } from './src/server/jobs.ts';
import {
  cancelJobRemote,
  checkAccountHealth,
  computeEffectiveConcurrency,
  disableAccountJobs,
  getSettings,
  isAccountSchedulable,
  isDispatcherActive,
  resumeDispatcher,
  startDispatcher,
  stopAll,
} from './src/server/dispatcher.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const DURATIONS = [4, 5, 6, 8, 10, 15];
const RATIOS = ['9:16', '16:9', '1:1'];

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const { inputImageUrl: _omitInput, ...jobColumns } = getTableColumns(videoJobs);

function publicAccount(a: typeof accounts.$inferSelect) {
  const { encryptedCredential: _secret, ...rest } = a;
  const provider = getProvider(a.providerId);
  return { ...rest, providerLabel: provider?.label || a.providerId };
}

function fail(res: express.Response, err: any) {
  console.error(err);
  res.status(500).json({ success: false, error: 'Lỗi máy chủ nội bộ' });
}

app.get('/api/auth/status', (req, res) => {
  res.json({ success: true, data: { required: isAuthRequired(), authenticated: isAuthenticated(req) } });
});
app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);

app.use('/api', requireAuth);
app.use('/media', requireAuth, express.static(VIDEO_DIR));

app.get('/api/providers', (_req, res) => {
  res.json({ success: true, data: listProviders().map(publicProvider) });
});

app.get('/api/state', async (_req, res) => {
  try {
    const grouped = await db.select({ status: videoJobs.status, total: sql<number>`count(*)::int` }).from(videoJobs).groupBy(videoJobs.status);
    const count = (status: string) => grouped.find(g => g.status === status)?.total || 0;
    const all = grouped.reduce((sum, g) => sum + g.total, 0);

    const allAccounts = await db.select().from(accounts);
    const onlineAccounts = allAccounts.filter(a => isAccountSchedulable(a)).length;
    const refImageCount = (await db.select({ total: sql<number>`count(*)::int` }).from(refImages))[0].total;
    const settings = await getSettings();

    const running = await db
      .select({
        id: videoJobs.id,
        prompt: videoJobs.prompt,
        progress: videoJobs.progress,
        elapsedSeconds: videoJobs.elapsedSeconds,
        aspectRatio: videoJobs.aspectRatio,
        duration: videoJobs.duration,
        thumbnailUrl: videoJobs.thumbnailUrl,
        startedAt: videoJobs.startedAt,
      })
      .from(videoJobs)
      .where(eq(videoJobs.status, 'running'))
      .orderBy(videoJobs.startedAt);

    const now = Date.now();
    res.json({
      success: true,
      data: {
        counts: {
          all,
          pending: count('pending'),
          running: count('running'),
          completed: count('completed'),
          failed: count('failed'),
          stopped: count('stopped'),
        },
        onlineAccounts,
        totalAccounts: allAccounts.length,
        concurrencyLimit: settings.concurrencyLimit,
        effectiveConcurrency: computeEffectiveConcurrency(settings.concurrencyLimit, allAccounts),
        refImageCount,
        runningJobs: running.map(({ startedAt, ...j }) => ({
          ...j,
          elapsedSeconds: startedAt ? Math.floor((now - startedAt.getTime()) / 1000) : j.elapsedSeconds,
        })),
        isDispatcherActive: isDispatcherActive(),
      },
    });
  } catch (err) {
    fail(res, err);
  }
});

app.get('/api/accounts', async (_req, res) => {
  try {
    const list = await db.select().from(accounts).orderBy(desc(accounts.id));
    res.json({ success: true, data: list.map(publicAccount) });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/accounts', async (req, res) => {
  try {
    const { name, credential, providerId, maxSlots } = req.body;
    if (!name || !credential) {
      return res.status(400).json({ success: false, error: 'Thiếu tên hoặc thông tin credential' });
    }
    const provider = getProvider(providerId || 'mock');
    if (!provider) {
      return res.status(400).json({ success: false, error: 'Nền tảng không tồn tại' });
    }
    if (!provider.available) {
      return res.status(400).json({ success: false, error: `Nền tảng ${provider.label} chưa khả dụng: ${provider.unavailableReason}` });
    }
    const slots = Number.isInteger(maxSlots) && maxSlots >= 1 && maxSlots <= 20 ? maxSlots : 1;

    const inserted = await db
      .insert(accounts)
      .values({
        name: String(name).slice(0, 80),
        maskedIdentifier: maskIdentifier(String(credential)),
        encryptedCredential: encryptCredential(String(credential)),
        providerId: provider.id,
        isEnabled: true,
        sessionStatus: 'offline',
        maxSlots: slots,
        healthReason: 'Đang kiểm tra phiên đăng nhập',
      })
      .returning();

    await checkAccountHealth(inserted[0]);
    const fresh = await db.select().from(accounts).where(eq(accounts.id, inserted[0].id));
    res.json({ success: true, data: publicAccount(fresh[0]) });
  } catch (err) {
    fail(res, err);
  }
});

app.patch('/api/accounts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { maxSlots, name } = req.body;
    const patch: Partial<typeof accounts.$inferInsert> = {};
    if (maxSlots !== undefined) {
      if (!Number.isInteger(maxSlots) || maxSlots < 1 || maxSlots > 20) {
        return res.status(400).json({ success: false, error: 'Số slot phải là số nguyên từ 1 đến 20' });
      }
      patch.maxSlots = maxSlots;
    }
    if (name !== undefined) patch.name = String(name).slice(0, 80);
    const updated = await db.update(accounts).set(patch).where(eq(accounts.id, id)).returning();
    if (!updated[0]) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' });
    res.json({ success: true, data: publicAccount(updated[0]) });
  } catch (err) {
    fail(res, err);
  }
});

app.patch('/api/accounts/:id/enable', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const enabled = !!req.body.isEnabled;
    const updated = await db
      .update(accounts)
      .set({ isEnabled: enabled, sessionStatus: 'offline', healthReason: enabled ? 'Đang kiểm tra phiên đăng nhập' : 'Tài khoản đã bị tắt' })
      .where(eq(accounts.id, id))
      .returning();
    if (!updated[0]) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' });

    if (enabled) {
      await checkAccountHealth(updated[0]);
    } else {
      await disableAccountJobs(id, 'ACCOUNT_DISCONNECTED', 'Tài khoản bị tắt giữa chừng, job được chuyển về Chờ để gán tài khoản Online khác');
    }
    const fresh = await db.select().from(accounts).where(eq(accounts.id, id));
    res.json({ success: true, data: publicAccount(fresh[0]) });
  } catch (err) {
    fail(res, err);
  }
});

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await disableAccountJobs(id, 'ACCOUNT_REMOVED', 'Tài khoản bị xóa khỏi pool, job được chuyển về Chờ để gán tài khoản khác');
    await db.delete(accounts).where(eq(accounts.id, id));
    res.json({ success: true, message: 'Đã xóa tài khoản, credential đã mã hóa và hủy session' });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/accounts/:id/health', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const found = await db.select().from(accounts).where(eq(accounts.id, id));
    if (!found[0]) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' });
    await checkAccountHealth(found[0]);
    const fresh = await db.select().from(accounts).where(eq(accounts.id, id));
    res.json({ success: true, data: publicAccount(fresh[0]) });
  } catch (err) {
    fail(res, err);
  }
});

app.get('/api/ref-images', async (_req, res) => {
  try {
    const list = await db.select().from(refImages).orderBy(desc(refImages.id));
    res.json({ success: true, data: list });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/ref-images', async (req, res) => {
  try {
    const { files } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, error: 'Danh sách file không hợp lệ' });
    }

    const saved: Array<typeof refImages.$inferSelect> = [];
    const errors: string[] = [];

    for (const item of files) {
      const filename = String(item?.filename || 'anh');
      const decoded = decodeImage(String(item?.dataUrl || ''));
      if (!decoded) {
        errors.push(`File ${filename} không phải ảnh PNG, JPG hoặc WebP hợp lệ`);
        continue;
      }
      if (decoded.bytes.length > MAX_IMAGE_BYTES) {
        errors.push(`File ${filename} vượt quá giới hạn 8MB`);
        continue;
      }

      const tag = normalizeTag(item?.tag || filename);
      if (!tag) {
        errors.push(`File ${filename}: tag không hợp lệ (chỉ gồm a-z, 0-9, gạch ngang, gạch dưới)`);
        continue;
      }
      const existing = await db.select({ id: refImages.id }).from(refImages).where(eq(refImages.tag, tag));
      if (existing.length > 0) {
        errors.push(`Tag @${tag} đã tồn tại trong kho ảnh`);
        continue;
      }

      const inserted = await db
        .insert(refImages)
        .values({
          tag,
          filename,
          dataUrl: `data:${decoded.mimeType};base64,${decoded.bytes.toString('base64')}`,
          mimeType: decoded.mimeType,
          fileSize: decoded.bytes.length,
        })
        .returning();
      saved.push(inserted[0]);
    }

    res.json({ success: true, data: saved, errors });
  } catch (err) {
    fail(res, err);
  }
});

app.delete('/api/ref-images/:tag', async (req, res) => {
  try {
    const tag = normalizeTag(req.params.tag);
    await db.delete(refImages).where(eq(refImages.tag, tag));
    res.json({ success: true, message: `Đã xóa ảnh tham chiếu @${tag}` });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/queue/enqueue', async (req, res) => {
  try {
    const { rawText, splitMode, duration, aspectRatio, providerId, batchRefTag } = req.body;
    const prompts = splitPrompts(rawText, splitMode);
    if (prompts.length === 0) {
      return res.status(400).json({ success: false, error: 'Văn bản prompt không được rỗng' });
    }

    const settings = await getSettings();
    const resolved = await resolveProvider(providerId || settings.defaultProviderId);
    if ('error' in resolved) {
      return res.status(400).json({ success: false, error: resolved.error });
    }
    const provider = resolved.provider;
    const jobDuration = Number(duration) || settings.defaultDuration;
    const jobRatio = aspectRatio || settings.defaultAspectRatio;
    const capabilityError = checkCapabilities(provider, jobDuration, jobRatio);
    if (capabilityError) {
      return res.status(400).json({ success: false, error: capabilityError });
    }

    const batchTag = batchRefTag ? normalizeTag(String(batchRefTag).replace(/^@/, '')) : '';
    const missingAll = new Set<string>();
    const rows: Array<typeof videoJobs.$inferInsert> = [];

    for (const promptText of prompts) {
      const tags = extractTags(promptText);
      if (batchTag && !tags.includes(batchTag)) tags.push(batchTag);
      const { snapshot, missing } = await resolveTags(tags);
      missing.forEach(t => missingAll.add(t));
      if (snapshot.length > provider.capabilities.maxRefImages) {
        return res.status(400).json({
          success: false,
          error: `${provider.label} chỉ nhận tối đa ${provider.capabilities.maxRefImages} ảnh tham chiếu mỗi video, prompt "${promptText.slice(0, 40)}…" có ${snapshot.length}`,
        });
      }
      rows.push({
        id: generateTaskId(),
        prompt: promptText,
        refTags: JSON.stringify(tags),
        refSnapshot: JSON.stringify(snapshot),
        providerId: provider.id,
        status: 'pending',
        progress: 0,
        duration: jobDuration,
        aspectRatio: jobRatio,
        attempts: 0,
      });
    }

    if (missingAll.size > 0) {
      const list = Array.from(missingAll).map(t => `@${t}`).join(', ');
      return res.status(400).json({ success: false, error: `Chưa có ảnh trong kho cho tag: ${list}. Vui lòng thêm ảnh hoặc sửa tag trước khi chạy.`, missingTags: Array.from(missingAll) });
    }

    const created = await db.insert(videoJobs).values(rows).returning(jobColumns);
    resumeDispatcher();
    res.json({ success: true, count: created.length, jobs: created });
  } catch (err) {
    fail(res, err);
  }
});

app.get('/api/queue/jobs', async (req, res) => {
  try {
    const status = String(req.query.status || 'all');
    const search = String(req.query.search || '').trim();
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '10')) || 10));
    const requestedPage = Math.max(1, parseInt(String(req.query.page || '1')) || 1);

    const conditions = [];
    if (status !== 'all') conditions.push(eq(videoJobs.status, status));
    if (search) {
      const term = `%${search.replace(/[%_\\]/g, m => `\\${m}`)}%`;
      conditions.push(or(ilike(videoJobs.prompt, term), like(videoJobs.id, term.toLowerCase())));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const total = (await db.select({ total: sql<number>`count(*)::int` }).from(videoJobs).where(where))[0].total;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPage, totalPages);

    const results = await db
      .select(jobColumns)
      .from(videoJobs)
      .where(where)
      .orderBy(desc(videoJobs.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    res.json({ success: true, data: results, pagination: { page, limit, total, totalPages } });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/queue/process', async (_req, res) => {
  try {
    const allAccounts = await db.select().from(accounts);
    if (!allAccounts.some(a => isAccountSchedulable(a))) {
      return res.status(400).json({ success: false, error: 'Không còn tài khoản Online nào trong pool! Vui lòng bật hoặc thêm tài khoản để chạy hàng đợi.' });
    }
    resumeDispatcher();
    res.json({ success: true, message: 'Đã khởi động bộ điều phối Dispatcher' });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/queue/stop-all', async (_req, res) => {
  try {
    await stopAll();
    res.json({ success: true, message: 'Đã dừng tất cả các luồng đang chạy' });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/queue/retry/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const updated = await db
      .update(videoJobs)
      .set({
        status: 'pending',
        progress: 0,
        attempts: 0,
        accountId: null,
        externalId: null,
        startedAt: null,
        finishedAt: null,
        lastProgressAt: null,
        elapsedSeconds: 0,
        errorCode: null,
        errorMessage: null,
      })
      .where(and(eq(videoJobs.id, id), or(eq(videoJobs.status, 'failed'), eq(videoJobs.status, 'stopped'))))
      .returning(jobColumns);
    if (!updated[0]) {
      return res.status(409).json({ success: false, error: 'Chỉ chạy lại được job Thất bại hoặc Đã dừng' });
    }
    await db.update(studioCards).set({ status: 'generating' }).where(eq(studioCards.jobId, id));
    resumeDispatcher();
    res.json({ success: true, data: updated[0] });
  } catch (err) {
    fail(res, err);
  }
});

app.delete('/api/queue/jobs/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const found = await db.select().from(videoJobs).where(eq(videoJobs.id, id));
    if (found[0]) {
      if (found[0].status === 'running') await cancelJobRemote(found[0]);
      await db.delete(videoJobs).where(eq(videoJobs.id, id));
      await removeVideoFiles(id);
      await db.update(studioCards).set({ status: 'idle', jobId: null }).where(and(eq(studioCards.jobId, id), eq(studioCards.status, 'generating')));
    }
    res.json({ success: true, message: 'Đã xóa job thành công' });
  } catch (err) {
    fail(res, err);
  }
});

app.delete('/api/queue/clear-finished', async (_req, res) => {
  try {
    const removed = await db.delete(videoJobs).where(eq(videoJobs.status, 'completed')).returning({ id: videoJobs.id });
    for (const row of removed) await removeVideoFiles(row.id);
    res.json({ success: true, message: 'Đã dọn sạch các job đã hoàn thành' });
  } catch (err) {
    fail(res, err);
  }
});

app.get('/api/studio/cards', async (_req, res) => {
  try {
    const list = await db.select().from(studioCards).orderBy(desc(studioCards.id));
    res.json({ success: true, data: list });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/studio/cards', async (req, res) => {
  try {
    const { inputImageUrl, posX, posY, prompt } = req.body;
    if (!inputImageUrl || !decodeImage(String(inputImageUrl))) {
      return res.status(400).json({ success: false, error: 'Ảnh đầu vào phải là PNG, JPG hoặc WebP hợp lệ' });
    }

    const inserted = await db
      .insert(studioCards)
      .values({
        inputImageUrl,
        posX: posX ?? 120 + Math.floor(Math.random() * 200),
        posY: posY ?? 120 + Math.floor(Math.random() * 150),
        prompt: prompt || '',
        status: 'idle',
      })
      .returning();

    res.json({ success: true, data: inserted[0] });
  } catch (err) {
    fail(res, err);
  }
});

app.patch('/api/studio/cards/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { posX, posY, prompt, inputImageUrl } = req.body;

    const patch: Partial<typeof studioCards.$inferInsert> = {};
    if (posX !== undefined) patch.posX = posX;
    if (posY !== undefined) patch.posY = posY;
    if (prompt !== undefined) patch.prompt = prompt;
    if (inputImageUrl !== undefined) {
      if (!decodeImage(String(inputImageUrl))) {
        return res.status(400).json({ success: false, error: 'Ảnh đầu vào phải là PNG, JPG hoặc WebP hợp lệ' });
      }
      patch.inputImageUrl = inputImageUrl;
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, error: 'Không có trường nào để cập nhật' });
    }

    const updated = await db.update(studioCards).set(patch).where(eq(studioCards.id, id)).returning();
    if (!updated[0]) return res.status(404).json({ success: false, error: 'Không tìm thấy thẻ' });
    res.json({ success: true, data: updated[0] });
  } catch (err) {
    fail(res, err);
  }
});

app.delete('/api/studio/cards/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(studioCards).where(eq(studioCards.id, id));
    res.json({ success: true, message: 'Đã xóa thẻ khỏi canvas' });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/studio/generate-all', async (_req, res) => {
  try {
    const settings = await getSettings();
    const resolved = await resolveProvider(settings.defaultProviderId);
    if ('error' in resolved) {
      return res.status(400).json({ success: false, error: resolved.error });
    }
    const provider = resolved.provider;
    const capabilityError = checkCapabilities(provider, settings.defaultDuration, settings.defaultAspectRatio);
    if (capabilityError) {
      return res.status(400).json({ success: false, error: capabilityError });
    }

    const cards = await db
      .select()
      .from(studioCards)
      .where(or(eq(studioCards.status, 'idle'), eq(studioCards.status, 'failed')))
      .orderBy(studioCards.id);

    let created = 0;
    const errors: string[] = [];

    for (const card of cards) {
      const promptText = card.prompt.trim() || 'Chuyển đổi hình ảnh sang video chuyển động tự nhiên';
      const tags = extractTags(promptText);
      const { snapshot, missing } = await resolveTags(tags);

      let problem: string | null = null;
      if (!decodeImage(card.inputImageUrl)) problem = `Thẻ #${card.id}: ảnh đầu vào không đọc được`;
      else if (missing.length > 0) problem = `Thẻ #${card.id}: chưa có ảnh trong kho cho ${missing.map(t => `@${t}`).join(', ')}`;
      else if (snapshot.length > provider.capabilities.maxRefImages) problem = `Thẻ #${card.id}: vượt quá ${provider.capabilities.maxRefImages} ảnh tham chiếu`;
      if (problem) {
        errors.push(problem);
        await db.update(studioCards).set({ status: 'failed' }).where(eq(studioCards.id, card.id));
        continue;
      }

      const taskId = generateTaskId();
      await db.insert(videoJobs).values({
        id: taskId,
        prompt: promptText,
        refTags: JSON.stringify(tags),
        refSnapshot: JSON.stringify(snapshot),
        inputImageUrl: card.inputImageUrl,
        providerId: provider.id,
        status: 'pending',
        duration: settings.defaultDuration,
        aspectRatio: settings.defaultAspectRatio,
      });
      await db.update(studioCards).set({ status: 'generating', jobId: taskId }).where(eq(studioCards.id, card.id));
      created += 1;
    }

    resumeDispatcher();
    res.json({ success: true, count: created, errors });
  } catch (err) {
    fail(res, err);
  }
});

app.get('/api/settings', async (_req, res) => {
  try {
    res.json({ success: true, data: await getSettings() });
  } catch (err) {
    fail(res, err);
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const body = req.body || {};
    const patch: Partial<typeof appSettings.$inferInsert> = { updatedAt: new Date() };
    const int = (value: unknown, min: number, max: number, label: string) => {
      if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
        throw new Error(`${label} phải là số nguyên từ ${min} đến ${max}`);
      }
      return value as number;
    };

    try {
      if (body.concurrencyLimit !== undefined) patch.concurrencyLimit = int(body.concurrencyLimit, 1, 50, 'Số luồng');
      if (body.maxRetries !== undefined) patch.maxRetries = int(body.maxRetries, 0, 10, 'Số lần retry');
      if (body.timeoutMinutes !== undefined) patch.timeoutMinutes = int(body.timeoutMinutes, 1, 240, 'Thời gian timeout');
      if (body.defaultDuration !== undefined) {
        if (!DURATIONS.includes(body.defaultDuration)) throw new Error('Thời lượng mặc định không hợp lệ');
        patch.defaultDuration = body.defaultDuration;
      }
      if (body.defaultAspectRatio !== undefined) {
        if (!RATIOS.includes(body.defaultAspectRatio)) throw new Error('Tỉ lệ mặc định không hợp lệ');
        patch.defaultAspectRatio = body.defaultAspectRatio;
      }
      if (body.defaultProviderId !== undefined) {
        if (body.defaultProviderId !== 'auto' && !getProvider(body.defaultProviderId)) throw new Error('Nền tảng mặc định không tồn tại');
        patch.defaultProviderId = body.defaultProviderId;
      }
      if (body.autoEnqueueOnPaste !== undefined) patch.autoEnqueueOnPaste = !!body.autoEnqueueOnPaste;
    } catch (validation: any) {
      return res.status(400).json({ success: false, error: validation.message });
    }

    const updated = await db.update(appSettings).set(patch).where(eq(appSettings.id, 1)).returning();
    res.json({ success: true, data: updated[0] });
  } catch (err) {
    fail(res, err);
  }
});

app.get('/api/progress', async (_req, res) => {
  try {
    const list = await db.select().from(projectProgress).orderBy(projectProgress.stt);
    res.json({ success: true, data: list });
  } catch (err) {
    fail(res, err);
  }
});

app.post('/api/progress', async (req, res) => {
  try {
    const { feature, acceptanceCriteria, status } = req.body;
    const next = (await db.select({ max: sql<number>`COALESCE(MAX(${projectProgress.stt}), 0)::int` }).from(projectProgress))[0].max + 1;

    const inserted = await db
      .insert(projectProgress)
      .values({ stt: next, feature, acceptanceCriteria, status: status || 'todo' })
      .returning();

    res.json({ success: true, data: inserted[0] });
  } catch (err) {
    fail(res, err);
  }
});

app.patch('/api/progress/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, feature, acceptanceCriteria } = req.body;

    const patch: Partial<typeof projectProgress.$inferInsert> = {};
    if (status !== undefined) patch.status = status;
    if (feature !== undefined) patch.feature = feature;
    if (acceptanceCriteria !== undefined) patch.acceptanceCriteria = acceptanceCriteria;

    const updated = await db.update(projectProgress).set(patch).where(eq(projectProgress.id, id)).returning();
    res.json({ success: true, data: updated[0] });
  } catch (err) {
    fail(res, err);
  }
});

app.delete('/api/progress/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(projectProgress).where(eq(projectProgress.id, id));
    res.json({ success: true, message: 'Đã xóa mục tiến độ' });
  } catch (err) {
    fail(res, err);
  }
});

await migrate();
startDispatcher();

if (process.env.NODE_ENV !== 'production') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Muse Batch Manager server running on port ${PORT}`);
});
