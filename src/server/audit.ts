import { db } from '../db/index.ts';
import { adminAuditLog } from '../db/schema.ts';

const SENSITIVE_KEY = /credential|secret|token|password|passwd|api[_-]?key|authorization|cookie/i;

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (!SENSITIVE_KEY.test(key)) out[key] = scrub(inner);
    }
    return out;
  }
  return value;
}

export async function writeAudit(actorVaid: string, action: string, target: string | null, detail?: unknown) {
  await db.insert(adminAuditLog).values({
    actorVaid,
    action,
    target,
    detail: detail === undefined ? null : JSON.stringify(scrub(detail)),
  });
}
