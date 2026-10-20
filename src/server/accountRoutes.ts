import express from 'express';
import { addAccount, deleteAccount, listAccounts, patchAccount, runHealthCheck, setAccountEnabled, OpResult } from './accountOps.ts';
import { currentUser, requireSuperAdmin } from './auth.ts';

function sendResult<T>(res: express.Response, result: OpResult<T>) {
  if (result.ok) return res.json({ success: true, data: result.data });
  res.status(result.status).json({ success: false, error: result.error });
}

function idParam(req: express.Request): number {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : -1;
}

function serverError(res: express.Response, err: unknown) {
  console.error(err);
  res.status(500).json({ success: false, error: 'Lỗi máy chủ nội bộ' });
}

export function createAccountsRouter(): express.Router {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      res.json({ success: true, data: await listAccounts() });
    } catch (err) {
      serverError(res, err);
    }
  });

  router.post('/', requireSuperAdmin, async (req, res) => {
    try {
      const { name, credential, providerId, maxSlots } = req.body || {};
      sendResult(res, await addAccount(currentUser(res).vaid, { name, credential, providerId: providerId || 'mock', maxSlots }));
    } catch (err) {
      serverError(res, err);
    }
  });

  router.patch('/:id', requireSuperAdmin, async (req, res) => {
    try {
      const { maxSlots, name } = req.body || {};
      sendResult(res, await patchAccount(currentUser(res).vaid, idParam(req), { maxSlots, name }));
    } catch (err) {
      serverError(res, err);
    }
  });

  router.patch('/:id/enable', async (req, res) => {
    try {
      sendResult(res, await setAccountEnabled(idParam(req), !!req.body?.isEnabled));
    } catch (err) {
      serverError(res, err);
    }
  });

  router.delete('/:id', requireSuperAdmin, async (req, res) => {
    try {
      const result = await deleteAccount(currentUser(res).vaid, idParam(req));
      if (!result.ok) return sendResult(res, result);
      res.json({ success: true, message: 'Đã xóa tài khoản, credential đã mã hóa và hủy session' });
    } catch (err) {
      serverError(res, err);
    }
  });

  router.post('/:id/health', async (req, res) => {
    try {
      sendResult(res, await runHealthCheck(idParam(req)));
    } catch (err) {
      serverError(res, err);
    }
  });

  return router;
}
