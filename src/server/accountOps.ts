import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { accounts } from '../db/schema.ts';
import { writeAudit } from './audit.ts';
import { encryptCredential, maskIdentifier } from './crypto.ts';
import { checkAccountHealth, disableAccountJobs } from './dispatcher.ts';
import { getProvider } from './providers/index.ts';

type AccountRow = typeof accounts.$inferSelect;

export type OpResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

export function publicAccount(a: AccountRow) {
  const { encryptedCredential: _secret, ...rest } = a;
  const provider = getProvider(a.providerId);
  return { ...rest, providerLabel: provider?.label || a.providerId };
}

function parseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= 80 ? name : null;
}

function parseCredential(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const credential = value.trim();
  return credential.length >= 1 && credential.length <= 4096 ? credential : null;
}

function parseSlots(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 20 ? (value as number) : null;
}

async function reload(id: number) {
  const rows = await db.select().from(accounts).where(eq(accounts.id, id));
  return rows[0];
}

export async function listAccounts() {
  return (await db.select().from(accounts).orderBy(desc(accounts.id))).map(publicAccount);
}

export async function addAccount(
  actor: string,
  input: { name: unknown; credential: unknown; providerId: unknown; maxSlots?: unknown },
): Promise<OpResult<ReturnType<typeof publicAccount>>> {
  const name = parseName(input.name);
  const credential = parseCredential(input.credential);
  if (!name || !credential) return fail(400, 'Cần tên (1-80 ký tự) và credential hợp lệ');
  const provider = typeof input.providerId === 'string' ? getProvider(input.providerId) : undefined;
  if (!provider) return fail(400, 'Nền tảng không tồn tại');
  if (!provider.available) return fail(400, `Nền tảng ${provider.label} chưa khả dụng: ${provider.unavailableReason}`);
  let slots = 1;
  if (input.maxSlots !== undefined) {
    const parsed = parseSlots(input.maxSlots);
    if (parsed === null) return fail(400, 'Số slot phải là số nguyên từ 1 đến 20');
    slots = parsed;
  }

  const inserted = await db
    .insert(accounts)
    .values({
      name,
      maskedIdentifier: maskIdentifier(credential),
      encryptedCredential: encryptCredential(credential),
      providerId: provider.id,
      isEnabled: true,
      sessionStatus: 'offline',
      maxSlots: slots,
      healthReason: 'Đang kiểm tra phiên đăng nhập',
    })
    .returning();

  await checkAccountHealth(inserted[0]);
  const fresh = await reload(inserted[0].id);
  await writeAudit(actor, 'account.add', `${provider.id}#${fresh.id}`, {
    after: { name, providerId: provider.id, maxSlots: slots, maskedIdentifier: fresh.maskedIdentifier, sessionStatus: fresh.sessionStatus },
  });
  return { ok: true, data: publicAccount(fresh) };
}

export async function rotateCredential(actor: string, id: number, credentialInput: unknown): Promise<OpResult<ReturnType<typeof publicAccount>>> {
  const credential = parseCredential(credentialInput);
  if (!credential) return fail(400, 'Credential không hợp lệ');
  const before = await reload(id);
  if (!before) return fail(404, 'Không tìm thấy tài khoản');

  const updated = await db
    .update(accounts)
    .set({
      maskedIdentifier: maskIdentifier(credential),
      encryptedCredential: encryptCredential(credential),
      sessionStatus: 'offline',
      healthReason: 'Đang kiểm tra phiên đăng nhập',
      cooldownUntil: null,
    })
    .where(eq(accounts.id, id))
    .returning();

  await checkAccountHealth(updated[0]);
  const fresh = await reload(id);
  await writeAudit(actor, 'account.rotate', `${before.providerId}#${id}`, {
    before: { maskedIdentifier: before.maskedIdentifier },
    after: { maskedIdentifier: fresh.maskedIdentifier, sessionStatus: fresh.sessionStatus },
  });
  return { ok: true, data: publicAccount(fresh) };
}

export async function setAccountEnabled(id: number, enabled: boolean): Promise<OpResult<ReturnType<typeof publicAccount>>> {
  const updated = await db
    .update(accounts)
    .set({ isEnabled: enabled, sessionStatus: 'offline', healthReason: enabled ? 'Đang kiểm tra phiên đăng nhập' : 'Tài khoản đã bị tắt' })
    .where(eq(accounts.id, id))
    .returning();
  if (!updated[0]) return fail(404, 'Không tìm thấy tài khoản');

  if (enabled) {
    await checkAccountHealth(updated[0]);
  } else {
    await disableAccountJobs(id, 'ACCOUNT_DISCONNECTED', 'Tài khoản bị tắt giữa chừng, job được chuyển về Chờ để gán tài khoản Online khác');
  }
  return { ok: true, data: publicAccount(await reload(id)) };
}

export async function patchAccount(
  actor: string,
  id: number,
  input: { name?: unknown; maxSlots?: unknown; isEnabled?: unknown },
): Promise<OpResult<ReturnType<typeof publicAccount>>> {
  const before = await reload(id);
  if (!before) return fail(404, 'Không tìm thấy tài khoản');

  const patch: Partial<typeof accounts.$inferInsert> = {};
  if (input.name !== undefined) {
    const name = parseName(input.name);
    if (!name) return fail(400, 'Tên phải từ 1 đến 80 ký tự');
    patch.name = name;
  }
  if (input.maxSlots !== undefined) {
    const slots = parseSlots(input.maxSlots);
    if (slots === null) return fail(400, 'Số slot phải là số nguyên từ 1 đến 20');
    patch.maxSlots = slots;
  }
  if (input.isEnabled !== undefined && typeof input.isEnabled !== 'boolean') return fail(400, 'isEnabled phải là true hoặc false');
  if (Object.keys(patch).length === 0 && input.isEnabled === undefined) return fail(400, 'Không có trường nào để cập nhật');

  if (Object.keys(patch).length > 0) await db.update(accounts).set(patch).where(eq(accounts.id, id));
  if (typeof input.isEnabled === 'boolean' && input.isEnabled !== before.isEnabled) {
    const toggled = await setAccountEnabled(id, input.isEnabled);
    if (!toggled.ok) return toggled;
  }

  const fresh = await reload(id);
  await writeAudit(actor, 'account.update', `${before.providerId}#${id}`, {
    before: { name: before.name, maxSlots: before.maxSlots, isEnabled: before.isEnabled },
    after: { name: fresh.name, maxSlots: fresh.maxSlots, isEnabled: fresh.isEnabled },
  });
  return { ok: true, data: publicAccount(fresh) };
}

export async function deleteAccount(actor: string, id: number): Promise<OpResult<null>> {
  const before = await reload(id);
  if (!before) return fail(404, 'Không tìm thấy tài khoản');
  await disableAccountJobs(id, 'ACCOUNT_REMOVED', 'Tài khoản bị xóa khỏi pool, job được chuyển về Chờ để gán tài khoản khác');
  await db.delete(accounts).where(eq(accounts.id, id));
  await writeAudit(actor, 'account.delete', `${before.providerId}#${id}`, {
    before: { name: before.name, maskedIdentifier: before.maskedIdentifier, maxSlots: before.maxSlots },
  });
  return { ok: true, data: null };
}

export async function runHealthCheck(id: number): Promise<OpResult<ReturnType<typeof publicAccount>>> {
  const found = await reload(id);
  if (!found) return fail(404, 'Không tìm thấy tài khoản');
  await checkAccountHealth(found);
  return { ok: true, data: publicAccount(await reload(id)) };
}
