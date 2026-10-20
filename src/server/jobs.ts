import crypto from 'crypto';
import { inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { accounts, refImages } from '../db/schema.ts';
import { isAccountSchedulable } from './dispatcher.ts';
import { getProvider, listProviders, VideoProvider } from './providers/index.ts';

const TASK_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function generateTaskId(): string {
  return `task_${Array.from(crypto.randomBytes(8), b => TASK_CHARS[b % TASK_CHARS.length]).join('')}`;
}

export async function resolveProvider(requested: string | undefined): Promise<{ provider: VideoProvider } | { error: string }> {
  if (requested && requested !== 'auto') {
    const provider = getProvider(requested);
    if (!provider) return { error: `Nền tảng "${requested}" không tồn tại` };
    if (!provider.available) return { error: `Nền tảng ${provider.label} chưa khả dụng: ${provider.unavailableReason}` };
    return { provider };
  }

  const allAccounts = await db.select().from(accounts);
  const usable = listProviders().filter(p => p.available);
  const freeSlots = (p: VideoProvider) =>
    allAccounts
      .filter(a => a.providerId === p.id && isAccountSchedulable(a))
      .reduce((sum, a) => sum + Math.max(1, a.maxSlots) - a.currentRunningJobs, 0);
  const withOnline = usable.filter(p => allAccounts.some(a => a.providerId === p.id && isAccountSchedulable(a)));
  if (withOnline.length > 0) {
    return { provider: withOnline.sort((a, b) => freeSlots(b) - freeSlots(a))[0] };
  }
  const withAny = usable.filter(p => allAccounts.some(a => a.providerId === p.id && a.isEnabled));
  if (withAny.length > 0) return { provider: withAny[0] };
  return { error: 'Chưa có tài khoản nào trong pool. Vui lòng thêm tài khoản ở tab Tài khoản trước.' };
}

export function checkCapabilities(provider: VideoProvider, duration: number, aspectRatio: string): string | null {
  if (!provider.capabilities.durations.includes(duration)) {
    return `${provider.label} chỉ hỗ trợ thời lượng: ${provider.capabilities.durations.join(', ')} giây`;
  }
  if (!provider.capabilities.aspectRatios.includes(aspectRatio)) {
    return `${provider.label} chỉ hỗ trợ tỉ lệ: ${provider.capabilities.aspectRatios.join(', ')}`;
  }
  return null;
}

export async function resolveTags(tags: string[]): Promise<{ snapshot: Array<{ tag: string; imageId: number }>; missing: string[] }> {
  if (tags.length === 0) return { snapshot: [], missing: [] };
  const rows = await db.select({ id: refImages.id, tag: refImages.tag }).from(refImages).where(inArray(refImages.tag, tags));
  const byTag = new Map(rows.map(r => [r.tag, r.id]));
  const snapshot: Array<{ tag: string; imageId: number }> = [];
  const missing: string[] = [];
  for (const tag of tags) {
    const imageId = byTag.get(tag);
    if (imageId === undefined) missing.push(tag);
    else snapshot.push({ tag, imageId });
  }
  return { snapshot, missing };
}

export function splitPrompts(rawText: string, mode: string): string[] {
  const text = String(rawText || '');
  if (mode === 'all') {
    const trimmed = text.trim();
    return trimmed ? [trimmed] : [];
  }
  const parts = mode === 'paragraph' ? text.split(/\n\s*\n/) : text.split('\n');
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}
