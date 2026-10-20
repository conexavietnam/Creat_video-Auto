import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from './src/db/index.ts';
import { accounts, refImages, videoJobs, studioCards, appSettings, systemLogs, projectProgress } from './src/db/schema.ts';
import { eq, desc, sql, inArray, like, or, and } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

function generateTaskId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 8; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `task_${rand}`;
}

function encryptCredential(plaintext: string): string {
  const encoded = Buffer.from(plaintext).toString('base64');
  return `enc_${encoded.substring(0, 12)}***sec`;
}

function sampleVideoUrl(ratio: string): string {
  return 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
}

function sampleThumbnailUrl(ratio: string): string {
  return 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80';
}

let dispatcherInterval: NodeJS.Timeout | null = null;
let isDispatcherRunning = false;

async function runDispatcherStep() {
  try {
    const settings = await db.select().from(appSettings).where(eq(appSettings.id, 1));
    const config = settings[0] || { concurrencyLimit: 3, maxRetries: 2, timeoutMinutes: 15 };

    const onlineAccounts = await db.select().from(accounts).where(and(eq(accounts.isEnabled, true), eq(accounts.sessionStatus, 'online')));
    if (onlineAccounts.length === 0) {
      return;
    }

    const runningJobs = await db.select().from(videoJobs).where(eq(videoJobs.status, 'running'));
    
    for (const job of runningJobs) {
      const now = new Date();
      const elapsed = job.startedAt ? Math.floor((now.getTime() - new Date(job.startedAt).getTime()) / 1000) : job.elapsedSeconds + 2;
      const newProgress = Math.min(99, Math.floor((elapsed / job.duration) * 100));

      if (elapsed > config.timeoutMinutes * 60) {
        if (job.attempts < config.maxRetries) {
          await db.update(videoJobs).set({
            status: 'pending',
            progress: 0,
            attempts: job.attempts + 1,
            errorCode: 'TIMEOUT',
            errorMessage: `Job quá thời hạn ${config.timeoutMinutes} phút mà không xong, tự động thử lại lần ${job.attempts + 1}`,
          }).where(eq(videoJobs.id, job.id));
        } else {
          await db.update(videoJobs).set({
            status: 'failed',
            progress: 0,
            errorCode: 'TIMEOUT_EXCEEDED',
            errorMessage: `Job bị treo vượt quá thời gian ${config.timeoutMinutes} phút sau ${job.attempts} lần thử`,
          }).where(eq(videoJobs.id, job.id));
        }
      } else if (newProgress >= 95) {
        const vidUrl = sampleVideoUrl(job.aspectRatio);
        const thumbUrl = sampleThumbnailUrl(job.aspectRatio);

        await db.update(videoJobs).set({
          status: 'completed',
          progress: 100,
          elapsedSeconds: elapsed,
          finishedAt: new Date(),
          videoUrl: vidUrl,
          thumbnailUrl: thumbUrl,
        }).where(eq(videoJobs.id, job.id));

        if (job.accountId) {
          await db.execute(sql`UPDATE accounts SET current_running_jobs = GREATEST(0, current_running_jobs - 1) WHERE id = ${job.accountId}`);
        }

        const studioCardMatch = await db.select().from(studioCards).where(eq(studioCards.jobId, job.id));
        if (studioCardMatch.length > 0) {
          await db.update(studioCards).set({
            status: 'completed',
            videoUrl: vidUrl,
          }).where(eq(studioCards.jobId, job.id));
        }
      } else {
        await db.update(videoJobs).set({
          progress: newProgress,
          elapsedSeconds: elapsed,
        }).where(eq(videoJobs.id, job.id));
      }
    }

    const currentRunningCount = (await db.select().from(videoJobs).where(eq(videoJobs.status, 'running'))).length;
    const maxAllowed = Math.min(config.concurrencyLimit, onlineAccounts.length * 2);
    const slotsAvailable = maxAllowed - currentRunningCount;

    if (slotsAvailable > 0 && isDispatcherRunning) {
      const pendingJobs = await db.select().from(videoJobs).where(eq(videoJobs.status, 'pending')).orderBy(videoJobs.createdAt).limit(slotsAvailable);

      for (let i = 0; i < pendingJobs.length; i++) {
        const pJob = pendingJobs[i];
        const assignedAccount = onlineAccounts[i % onlineAccounts.length];

        await db.update(videoJobs).set({
          status: 'running',
          accountId: assignedAccount.id,
          startedAt: new Date(),
          progress: 5,
        }).where(eq(videoJobs.id, pJob.id));

        await db.execute(sql`UPDATE accounts SET current_running_jobs = current_running_jobs + 1 WHERE id = ${assignedAccount.id}`);
      }
    }
  } catch (err) {
    console.error('Error in dispatcher step:', err);
  }
}

function startDispatcher() {
  if (!dispatcherInterval) {
    isDispatcherRunning = true;
    dispatcherInterval = setInterval(runDispatcherStep, 2000);
  }
}

function stopDispatcher() {
  isDispatcherRunning = false;
  if (dispatcherInterval) {
    clearInterval(dispatcherInterval);
    dispatcherInterval = null;
  }
}

startDispatcher();

app.get('/api/state', async (req, res) => {
  try {
    const allJobs = await db.select().from(videoJobs);
    const pendingCount = allJobs.filter(j => j.status === 'pending').length;
    const runningJobs = allJobs.filter(j => j.status === 'running');
    const completedCount = allJobs.filter(j => j.status === 'completed').length;
    const failedCount = allJobs.filter(j => j.status === 'failed').length;
    const stoppedCount = allJobs.filter(j => j.status === 'stopped').length;

    const allAccounts = await db.select().from(accounts);
    const onlineAccountsCount = allAccounts.filter(a => a.isEnabled && a.sessionStatus === 'online').length;

    const allRefImages = await db.select().from(refImages);

    res.json({
      success: true,
      data: {
        counts: {
          all: allJobs.length,
          pending: pendingCount,
          running: runningJobs.length,
          completed: completedCount,
          failed: failedCount,
          stopped: stoppedCount,
        },
        onlineAccounts: onlineAccountsCount,
        totalAccounts: allAccounts.length,
        refImageCount: allRefImages.length,
        runningJobs: runningJobs.map(j => ({
          id: j.id,
          prompt: j.prompt,
          progress: j.progress,
          elapsedSeconds: j.elapsedSeconds,
          aspectRatio: j.aspectRatio,
          duration: j.duration,
          thumbnailUrl: j.thumbnailUrl || sampleThumbnailUrl(j.aspectRatio),
        })),
        isDispatcherActive: isDispatcherRunning,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/accounts', async (req, res) => {
  try {
    const list = await db.select().from(accounts).orderBy(desc(accounts.id));
    res.json({ success: true, data: list });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/accounts', async (req, res) => {
  try {
    const { name, credential } = req.body;
    if (!name || !credential) {
      return res.status(400).json({ success: false, error: 'Thiếu tên hoặc thông tin credential' });
    }
    const masked = `usr_${Math.floor(1000 + Math.random() * 9000)}***sec`;
    const encrypted = encryptCredential(credential);

    const result = await db.insert(accounts).values({
      name,
      maskedIdentifier: masked,
      encryptedCredential: encrypted,
      isEnabled: true,
      sessionStatus: 'online',
      currentRunningJobs: 0,
      maxSlots: 1,
      healthReason: 'Tài khoản đăng nhập thành công',
    }).returning();

    res.json({ success: true, data: result[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/accounts/:id/enable', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { isEnabled } = req.body;
    
    const updated = await db.update(accounts).set({
      isEnabled: !!isEnabled,
      sessionStatus: isEnabled ? 'online' : 'offline',
    }).where(eq(accounts.id, id)).returning();

    if (!isEnabled) {
      const affectedJobs = await db.select().from(videoJobs).where(and(eq(videoJobs.accountId, id), eq(videoJobs.status, 'running')));
      for (const job of affectedJobs) {
        await db.update(videoJobs).set({
          status: 'pending',
          progress: 0,
          accountId: null,
          errorCode: 'ACCOUNT_DISCONNECTED',
          errorMessage: 'Tài khoản ngắt kết nối giữa chừng, tự động chuyển về Chờ để gán tài khoản Online khác',
        }).where(eq(videoJobs.id, job.id));
      }
      await db.update(accounts).set({ currentRunningJobs: 0 }).where(eq(accounts.id, id));
    }

    res.json({ success: true, data: updated[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const runningOnAcc = await db.select().from(videoJobs).where(and(eq(videoJobs.accountId, id), eq(videoJobs.status, 'running')));
    
    for (const job of runningOnAcc) {
      await db.update(videoJobs).set({
        status: 'pending',
        progress: 0,
        accountId: null,
        errorCode: 'ACCOUNT_REMOVED',
        errorMessage: 'Tài khoản bị xóa khỏi pool, tự động gán lại cho tài khoản khác',
      }).where(eq(videoJobs.id, job.id));
    }

    await db.delete(accounts).where(eq(accounts.id, id));
    res.json({ success: true, message: 'Đã xóa tài khoản và giải phóng session' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/accounts/:id/health', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const acc = await db.select().from(accounts).where(eq(accounts.id, id));
    if (!acc[0]) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' });

    const updated = await db.update(accounts).set({
      lastHealthCheck: new Date(),
      sessionStatus: 'online',
      healthReason: 'Phiên đăng nhập bình thường, kết nối ổn định',
    }).where(eq(accounts.id, id)).returning();

    res.json({ success: true, data: updated[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/ref-images', async (req, res) => {
  try {
    const list = await db.select().from(refImages).orderBy(desc(refImages.id));
    res.json({ success: true, data: list });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/ref-images', async (req, res) => {
  try {
    const { files } = req.body;
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, error: 'Danh sách file không hợp lệ' });
    }

    const saved: any[] = [];
    const errors: string[] = [];

    for (const item of files) {
      const { tag, filename, dataUrl, mimeType, fileSize } = item;
      
      if (fileSize > 8 * 1024 * 1024) {
        errors.push(`File ${filename} vượt quá giới hạn 8MB`);
        continue;
      }

      const cleanTag = tag ? tag.toLowerCase().replace(/[^a-z0-9-_]/g, '') : 'ref';
      const existing = await db.select().from(refImages).where(eq(refImages.tag, cleanTag));

      if (existing.length > 0) {
        errors.push(`Tag @${cleanTag} đã tồn tại trong kho ảnh`);
        continue;
      }

      const inserted = await db.insert(refImages).values({
        tag: cleanTag,
        filename: filename || `${cleanTag}.png`,
        dataUrl: dataUrl || '',
        mimeType: mimeType || 'image/png',
        fileSize: fileSize || 0,
      }).returning();

      saved.push(inserted[0]);
    }

    res.json({ success: true, data: saved, errors });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/ref-images/:tag', async (req, res) => {
  try {
    const tag = req.params.tag;
    await db.delete(refImages).where(eq(refImages.tag, tag));
    res.json({ success: true, message: `Đã xóa ảnh tham chiếu @${tag}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/queue/enqueue', async (req, res) => {
  try {
    const { rawText, splitMode, duration, aspectRatio, concurrency } = req.body;
    if (!rawText || !rawText.trim()) {
      return res.status(400).json({ success: false, error: 'Văn bản prompt không được rỗng' });
    }

    let prompts: string[] = [];
    if (splitMode === 'paragraph') {
      prompts = rawText.split(/\n\s*\n/).map((p: string) => p.trim()).filter((p: string) => p.length > 0);
    } else if (splitMode === 'all') {
      prompts = [rawText.trim()];
    } else {
      prompts = rawText.split('\n').map((p: string) => p.trim()).filter((p: string) => p.length > 0);
    }

    if (concurrency) {
      await db.update(appSettings).set({ concurrencyLimit: concurrency }).where(eq(appSettings.id, 1));
    }

    const allRefImgs = await db.select().from(refImages);
    const createdJobs: any[] = [];

    for (const promptText of prompts) {
      const matches = promptText.match(/@([a-z0-9-_]+)/gi) || [];
      const extractedTags = matches.map(m => m.substring(1).toLowerCase());
      const uniqueTags = Array.from(new Set(extractedTags));

      const taskId = generateTaskId();

      const inserted = await db.insert(videoJobs).values({
        id: taskId,
        prompt: promptText,
        refTags: JSON.stringify(uniqueTags),
        status: 'pending',
        progress: 0,
        duration: duration || 10,
        aspectRatio: aspectRatio || '9:16',
        attempts: 0,
      }).returning();

      createdJobs.push(inserted[0]);
    }

    isDispatcherRunning = true;
    startDispatcher();

    res.json({ success: true, count: createdJobs.length, jobs: createdJobs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/queue/jobs', async (req, res) => {
  try {
    const status = req.query.status as string;
    const search = req.query.search as string;
    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '10');
    const offset = (page - 1) * limit;

    let query = db.select().from(videoJobs);

    const conditions: any[] = [];
    if (status && status !== 'all') {
      conditions.push(eq(videoJobs.status, status));
    }
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(or(like(videoJobs.prompt, term), like(videoJobs.id, term)));
    }

    let results = [];
    if (conditions.length > 0) {
      results = await db.select().from(videoJobs).where(and(...conditions)).orderBy(desc(videoJobs.createdAt)).limit(limit).offset(offset);
    } else {
      results = await db.select().from(videoJobs).orderBy(desc(videoJobs.createdAt)).limit(limit).offset(offset);
    }

    const totalRes = await db.select().from(videoJobs);
    const totalCount = conditions.length > 0 ? (await db.select().from(videoJobs).where(and(...conditions))).length : totalRes.length;

    res.json({
      success: true,
      data: results,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit) || 1,
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/queue/process', async (req, res) => {
  try {
    isDispatcherRunning = true;
    startDispatcher();
    res.json({ success: true, message: 'Đã khởi động bộ điều phối Dispatcher' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/queue/stop-all', async (req, res) => {
  try {
    stopDispatcher();
    await db.update(videoJobs).set({ status: 'stopped' }).where(eq(videoJobs.status, 'running'));
    await db.execute(sql`UPDATE accounts SET current_running_jobs = 0`);
    res.json({ success: true, message: 'Đã dừng tất cả các luồng đang chạy' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/queue/retry/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const updated = await db.update(videoJobs).set({
      status: 'pending',
      progress: 0,
      attempts: 0,
      errorCode: null,
      errorMessage: null,
    }).where(eq(videoJobs.id, id)).returning();

    isDispatcherRunning = true;
    startDispatcher();

    res.json({ success: true, data: updated[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/queue/jobs/:id', async (req, res) => {
  try {
    const id = req.params.id;
    await db.delete(videoJobs).where(eq(videoJobs.id, id));
    res.json({ success: true, message: 'Đã xóa job thành công' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/queue/clear-finished', async (req, res) => {
  try {
    await db.delete(videoJobs).where(eq(videoJobs.status, 'completed'));
    res.json({ success: true, message: 'Đã dọn sạch các job đã hoàn thành' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/studio/cards', async (req, res) => {
  try {
    const list = await db.select().from(studioCards).orderBy(desc(studioCards.id));
    res.json({ success: true, data: list });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/studio/cards', async (req, res) => {
  try {
    const { inputImageUrl, posX, posY, prompt } = req.body;
    if (!inputImageUrl) {
      return res.status(400).json({ success: false, error: 'Thiếu ảnh đầu vào cho thẻ Studio' });
    }

    const inserted = await db.insert(studioCards).values({
      inputImageUrl,
      posX: posX || 120 + Math.floor(Math.random() * 200),
      posY: posY || 120 + Math.floor(Math.random() * 150),
      prompt: prompt || '',
      status: 'idle',
    }).returning();

    res.json({ success: true, data: inserted[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/studio/cards/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { posX, posY, prompt, inputImageUrl } = req.body;

    const patch: any = {};
    if (posX !== undefined) patch.posX = posX;
    if (posY !== undefined) patch.posY = posY;
    if (prompt !== undefined) patch.prompt = prompt;
    if (inputImageUrl !== undefined) patch.inputImageUrl = inputImageUrl;

    const updated = await db.update(studioCards).set(patch).where(eq(studioCards.id, id)).returning();
    res.json({ success: true, data: updated[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/studio/cards/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(studioCards).where(eq(studioCards.id, id));
    res.json({ success: true, message: 'Đã xóa thẻ khỏi canvas' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/studio/generate-all', async (req, res) => {
  try {
    const cards = await db.select().from(studioCards).where(or(eq(studioCards.status, 'idle'), eq(studioCards.status, 'failed')));
    const createdJobs: any[] = [];

    for (const card of cards) {
      const taskId = generateTaskId();
      const promptText = card.prompt || 'Chuyển đổi hình ảnh sang video chuyển động cao cấp';

      const matches = promptText.match(/@([a-z0-9-_]+)/gi) || [];
      const extractedTags = matches.map(m => m.substring(1).toLowerCase());

      const insertedJob = await db.insert(videoJobs).values({
        id: taskId,
        prompt: promptText,
        refTags: JSON.stringify(extractedTags),
        status: 'pending',
        progress: 0,
        duration: 10,
        aspectRatio: '9:16',
      }).returning();

      await db.update(studioCards).set({
        status: 'generating',
        jobId: taskId,
      }).where(eq(studioCards.id, card.id));

      createdJobs.push(insertedJob[0]);
    }

    isDispatcherRunning = true;
    startDispatcher();

    res.json({ success: true, count: createdJobs.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    const resList = await db.select().from(appSettings).where(eq(appSettings.id, 1));
    const config = resList[0] || { id: 1, concurrencyLimit: 3, maxRetries: 2, timeoutMinutes: 15, autoEnqueueOnPaste: true };
    res.json({ success: true, data: config });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  try {
    const { concurrencyLimit, maxRetries, timeoutMinutes, autoEnqueueOnPaste } = req.body;
    const updated = await db.update(appSettings).set({
      concurrencyLimit: concurrencyLimit || 3,
      maxRetries: maxRetries || 2,
      timeoutMinutes: timeoutMinutes || 15,
      autoEnqueueOnPaste: autoEnqueueOnPaste !== undefined ? autoEnqueueOnPaste : true,
      updatedAt: new Date(),
    }).where(eq(appSettings.id, 1)).returning();

    res.json({ success: true, data: updated[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/progress', async (req, res) => {
  try {
    const list = await db.select().from(projectProgress).orderBy(projectProgress.stt);
    res.json({ success: true, data: list });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/progress', async (req, res) => {
  try {
    const { feature, acceptanceCriteria, status } = req.body;
    const currentMax = await db.select().from(projectProgress);
    const nextStt = currentMax.length + 1;

    const inserted = await db.insert(projectProgress).values({
      stt: nextStt,
      feature,
      acceptanceCriteria,
      status: status || 'todo',
    }).returning();

    res.json({ success: true, data: inserted[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/progress/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, feature, acceptanceCriteria } = req.body;

    const patch: any = {};
    if (status !== undefined) patch.status = status;
    if (feature !== undefined) patch.feature = feature;
    if (acceptanceCriteria !== undefined) patch.acceptanceCriteria = acceptanceCriteria;

    const updated = await db.update(projectProgress).set(patch).where(eq(projectProgress.id, id)).returning();
    res.json({ success: true, data: updated[0] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/progress/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(projectProgress).where(eq(projectProgress.id, id));
    res.json({ success: true, message: 'Đã xóa mục tiến độ' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

if (process.env.NODE_ENV !== 'production') {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Muse Batch Manager server running on port ${PORT}`);
});
