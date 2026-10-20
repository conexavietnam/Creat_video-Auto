import express from 'express';
import { desc, eq, lt } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { accounts, adminAuditLog, appSettings, providerSettings } from '../db/schema.ts';
import { addAccount, deleteAccount, patchAccount, rotateCredential, runHealthCheck, OpResult } from './accountOps.ts';
import { computeStats, resolveRange } from './adminStats.ts';
import { writeAudit } from './audit.ts';
import { currentUser } from './auth.ts';
import { effectiveModel, refreshProviderConfigs } from './providerConfig.ts';
import { getProvider, listProviders } from './providers/index.ts';
import { applySettingsPatch, validateSettingsPatch } from './settingsOps.ts';

const MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,100}$/;
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal)$/i;
const PRIVATE_IPV4 = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function respond<T>(res: express.Response, result: OpResult<T>) {
  if (result.ok) return res.json({ success: true, data: result.data });
  res.status(result.status).json({ success: false, error: result.error });
}

function serverError(res: express.Response, err: unknown) {
  console.error(err);
  res.status(500).json({ success: false, error: 'Lỗi máy chủ nội bộ' });
}

function parseId(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validateBaseUrl(value: string): string | null {
  if (value.length > 200) return 'Base URL tối đa 200 ký tự';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Base URL không hợp lệ';
  }
  if (url.protocol !== 'https:') return 'Base URL phải bắt đầu bằng https://';
  if (url.username || url.password) return 'Base URL không được chứa tên đăng nhập hoặc mật khẩu';
  const host = url.hostname;
  if (PRIVATE_HOST.test(host) || PRIVATE_IPV4.test(host) || host.includes(':') || host === '[::1]') {
    return 'Base URL không được trỏ tới địa chỉ nội bộ';
  }
  return null;
}

async function providerView(providerId: string) {
  const provider = getProvider(providerId)!;
  const rows = await db.select().from(providerSettings).where(eq(providerSettings.providerId, providerId));
  const row = rows[0];
  const accountRows = await db.select().from(accounts).where(eq(accounts.providerId, providerId)).orderBy(accounts.id);
  return {
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    credentialHint: provider.credentialHint,
    available: provider.available,
    unavailableReason: provider.available ? null : provider.unavailableReason ?? null,
    capabilities: provider.capabilities,
    settings: {
      enabled: row ? row.enabled : true,
      model: row?.model ?? null,
      baseUrl: row?.baseUrl ?? null,
      pricePerSecondUsd: row?.pricePerSecondUsd == null ? null : Number(row.pricePerSecondUsd),
      notes: row?.notes ?? null,
      effectiveModel: effectiveModel(providerId) ?? null,
    },
    accounts: accountRows.map(a => ({
      id: a.id,
      name: a.name,
      maskedIdentifier: a.maskedIdentifier,
      isEnabled: a.isEnabled,
      sessionStatus: a.sessionStatus,
      healthReason: a.healthReason,
      maxSlots: a.maxSlots,
      currentRunningJobs: a.currentRunningJobs,
      lastHealthCheck: a.lastHealthCheck,
    })),
  };
}

export function createAdminRouter(): express.Router {
  const router = express.Router();
  router.get('/me', (_req, res) => {
    const user = currentUser(res);
    res.json({ success: true, data: { vaid: user.vaid, name: user.name } });
  });

  router.get('/providers', async (_req, res) => {
    try {
      const data = await Promise.all(listProviders().map(p => providerView(p.id)));
      res.json({ success: true, data });
    } catch (err) {
      serverError(res, err);
    }
  });

  router.put('/providers/:id', async (req, res) => {
    try {
      const provider = getProvider(req.params.id);
      if (!provider) return res.status(404).json({ success: false, error: 'Nền tảng không tồn tại' });
      const body = req.body || {};
      const patch: Partial<typeof providerSettings.$inferInsert> = {};

      if (body.enabled !== undefined) {
        if (typeof body.enabled !== 'boolean') return res.status(400).json({ success: false, error: 'enabled phải là true hoặc false' });
        patch.enabled = body.enabled;
      }
      if (body.model !== undefined) {
        if (body.model !== null && (typeof body.model !== 'string' || !MODEL_PATTERN.test(body.model.trim()))) {
          return res.status(400).json({ success: false, error: 'Model chỉ gồm chữ, số, . _ : / - và tối đa 100 ký tự' });
        }
        patch.model = body.model === null || body.model.trim() === '' ? null : body.model.trim();
      }
      if (body.baseUrl !== undefined) {
        if (body.baseUrl === null || (typeof body.baseUrl === 'string' && body.baseUrl.trim() === '')) {
          patch.baseUrl = null;
        } else {
          const problem = typeof body.baseUrl === 'string' ? validateBaseUrl(body.baseUrl.trim()) : 'Base URL không hợp lệ';
          if (problem) return res.status(400).json({ success: false, error: problem });
          patch.baseUrl = body.baseUrl.trim();
        }
      }
      if (body.pricePerSecondUsd !== undefined) {
        const price = body.pricePerSecondUsd;
        if (price !== null && (typeof price !== 'number' || !Number.isFinite(price) || price < 0 || price > 1000)) {
          return res.status(400).json({ success: false, error: 'Đơn giá phải là số từ 0 đến 1000 (USD/giây)' });
        }
        patch.pricePerSecondUsd = price === null ? null : price.toFixed(4);
      }
      if (body.notes !== undefined) {
        if (body.notes !== null && (typeof body.notes !== 'string' || body.notes.length > 500)) {
          return res.status(400).json({ success: false, error: 'Ghi chú tối đa 500 ký tự' });
        }
        patch.notes = body.notes === null || body.notes.trim() === '' ? null : body.notes.trim();
      }
      if (Object.keys(patch).length === 0) return res.status(400).json({ success: false, error: 'Không có trường nào để cập nhật' });

      const actor = currentUser(res).vaid;
      const snapshot = (row?: typeof providerSettings.$inferSelect) => ({
        enabled: row ? row.enabled : true,
        model: row?.model ?? null,
        baseUrl: row?.baseUrl ?? null,
        pricePerSecondUsd: row?.pricePerSecondUsd == null ? null : Number(row.pricePerSecondUsd),
        notes: row?.notes ?? null,
      });
      const beforeRow = (await db.select().from(providerSettings).where(eq(providerSettings.providerId, provider.id)))[0];
      const values = { providerId: provider.id, ...patch, updatedAt: new Date(), updatedBy: actor };
      await db.insert(providerSettings).values(values).onConflictDoUpdate({ target: providerSettings.providerId, set: values });
      const afterRow = (await db.select().from(providerSettings).where(eq(providerSettings.providerId, provider.id)))[0];

      await refreshProviderConfigs();
      await writeAudit(actor, 'provider.update', provider.id, { before: snapshot(beforeRow), after: snapshot(afterRow) });
      res.json({ success: true, data: await providerView(provider.id) });
    } catch (err) {
      serverError(res, err);
    }
  });

  router.post('/providers/:id/accounts', async (req, res) => {
    try {
      const body = req.body || {};
      respond(
        res,
        await addAccount(currentUser(res).vaid, {
          name: body.name,
          credential: body.credential,
          providerId: req.params.id,
          maxSlots: body.maxSlots,
        }),
      );
    } catch (err) {
      serverError(res, err);
    }
  });

  router.put('/accounts/:id/credential', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' });
      respond(res, await rotateCredential(currentUser(res).vaid, id, req.body?.credential));
    } catch (err) {
      serverError(res, err);
    }
  });

  router.patch('/accounts/:id', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' });
      const body = req.body || {};
      respond(res, await patchAccount(currentUser(res).vaid, id, { name: body.name, maxSlots: body.maxSlots, isEnabled: body.isEnabled }));
    } catch (err) {
      serverError(res, err);
    }
  });

  router.delete('/accounts/:id', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' });
      respond(res, await deleteAccount(currentUser(res).vaid, id));
    } catch (err) {
      serverError(res, err);
    }
  });

  router.post('/accounts/:id/health', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' });
      respond(res, await runHealthCheck(id));
    } catch (err) {
      serverError(res, err);
    }
  });

  router.get('/settings', async (_req, res) => {
    try {
      const rows = await db.select().from(appSettings).where(eq(appSettings.id, 1));
      res.json({ success: true, data: rows[0] });
    } catch (err) {
      serverError(res, err);
    }
  });

  router.put('/settings', async (req, res) => {
    try {
      const checked = validateSettingsPatch(req.body);
      if (!checked.ok) return res.status(400).json({ success: false, error: checked.error });
      if (Object.keys(checked.patch).length === 0) return res.status(400).json({ success: false, error: 'Không có trường nào để cập nhật' });

      const before = (await db.select().from(appSettings).where(eq(appSettings.id, 1)))[0] as Record<string, unknown>;
      const updated = await applySettingsPatch(checked.patch);
      const keys = Object.keys(checked.patch);
      const pick = (source: Record<string, unknown>) => Object.fromEntries(keys.map(k => [k, source[k]]));
      await writeAudit(currentUser(res).vaid, 'settings.update', 'app_settings', {
        before: pick(before),
        after: pick(updated as Record<string, unknown>),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      serverError(res, err);
    }
  });

  router.get('/stats', async (req, res) => {
    try {
      const range = resolveRange(req.query.from, req.query.to);
      if (!range.ok) return res.status(400).json({ success: false, error: range.error });
      const priceRows = await db.select().from(providerSettings);
      const prices = new Map(priceRows.map(r => [r.providerId, r.pricePerSecondUsd == null ? null : Number(r.pricePerSecondUsd)]));
      res.json({ success: true, data: await computeStats(range.from, range.to, prices) });
    } catch (err) {
      serverError(res, err);
    }
  });

  router.get('/audit', async (req, res) => {
    try {
      const requested = Number(req.query.limit ?? 50);
      const limit = Number.isInteger(requested) ? Math.min(200, Math.max(1, requested)) : 50;
      const beforeRaw = req.query.before;
      let before: number | null = null;
      if (beforeRaw !== undefined) {
        before = Number(beforeRaw);
        if (!Number.isInteger(before) || before < 1) return res.status(400).json({ success: false, error: 'before phải là số nguyên dương' });
      }
      const query = db.select().from(adminAuditLog);
      const rows = await (before === null ? query : query.where(lt(adminAuditLog.id, before)))
        .orderBy(desc(adminAuditLog.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      res.json({
        success: true,
        data: {
          items: page.map(r => ({
            id: r.id,
            at: r.at,
            actorVaid: r.actorVaid,
            action: r.action,
            target: r.target,
            detail: r.detail ? JSON.parse(r.detail) : null,
          })),
          nextBefore: rows.length > limit ? page[page.length - 1].id : null,
        },
      });
    } catch (err) {
      serverError(res, err);
    }
  });

  router.use((_req, res) => {
    res.status(404).json({ success: false, error: 'Không tìm thấy' });
  });

  return router;
}
