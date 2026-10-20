import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { appSettings } from '../db/schema.ts';
import { getProvider } from './providers/index.ts';

export const DURATIONS = [4, 5, 6, 8, 10, 15];
export const RATIOS = ['9:16', '16:9', '1:1'];

type SettingsPatch = Partial<typeof appSettings.$inferInsert>;

function int(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${label} phải là số nguyên từ ${min} đến ${max}`);
  }
  return value as number;
}

export function validateSettingsPatch(body: any): { ok: true; patch: SettingsPatch } | { ok: false; error: string } {
  const input = body || {};
  const patch: SettingsPatch = {};
  try {
    if (input.concurrencyLimit !== undefined) patch.concurrencyLimit = int(input.concurrencyLimit, 1, 50, 'Số luồng');
    if (input.maxRetries !== undefined) patch.maxRetries = int(input.maxRetries, 0, 10, 'Số lần retry');
    if (input.timeoutMinutes !== undefined) patch.timeoutMinutes = int(input.timeoutMinutes, 1, 240, 'Thời gian timeout');
    if (input.defaultDuration !== undefined) {
      if (!DURATIONS.includes(input.defaultDuration)) throw new Error('Thời lượng mặc định không hợp lệ');
      patch.defaultDuration = input.defaultDuration;
    }
    if (input.defaultAspectRatio !== undefined) {
      if (!RATIOS.includes(input.defaultAspectRatio)) throw new Error('Tỉ lệ mặc định không hợp lệ');
      patch.defaultAspectRatio = input.defaultAspectRatio;
    }
    if (input.defaultProviderId !== undefined) {
      if (input.defaultProviderId !== 'auto' && !getProvider(input.defaultProviderId)) throw new Error('Nền tảng mặc định không tồn tại');
      patch.defaultProviderId = input.defaultProviderId;
    }
    if (input.autoEnqueueOnPaste !== undefined) patch.autoEnqueueOnPaste = !!input.autoEnqueueOnPaste;
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
  return { ok: true, patch };
}

export async function applySettingsPatch(patch: SettingsPatch) {
  const updated = await db
    .update(appSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(appSettings.id, 1))
    .returning();
  return updated[0];
}
