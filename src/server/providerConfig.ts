import { db } from '../db/index.ts';
import { providerSettings } from '../db/schema.ts';

export interface ProviderConfig {
  enabled: boolean;
  model: string | null;
  baseUrl: string | null;
}

const CACHE_TTL_MS = 10_000;

const DEFAULTS: Record<string, { model?: string; baseUrl?: string }> = {
  veo: { model: process.env.VEO_MODEL || 'veo-3.1-generate-preview' },
  kling: {
    model: process.env.KLING_MODEL || 'kling-v2-master',
    baseUrl: process.env.KLING_BASE_URL || 'https://api.klingai.com',
  },
};

let cache = new Map<string, ProviderConfig>();
let timer: NodeJS.Timeout | null = null;

export async function refreshProviderConfigs(): Promise<void> {
  const rows = await db.select().from(providerSettings);
  const next = new Map<string, ProviderConfig>();
  for (const row of rows) {
    next.set(row.providerId, { enabled: row.enabled, model: row.model, baseUrl: row.baseUrl });
  }
  cache = next;
}

export function startProviderConfigRefresh() {
  if (timer) return;
  timer = setInterval(() => {
    refreshProviderConfigs().catch(err => console.error('Không đọc được provider_settings:', err));
  }, CACHE_TTL_MS);
  timer.unref();
}

export function getProviderConfig(providerId: string): ProviderConfig {
  return cache.get(providerId) || { enabled: true, model: null, baseUrl: null };
}

export function isProviderEnabled(providerId: string): boolean {
  return getProviderConfig(providerId).enabled;
}

export function effectiveModel(providerId: string): string | undefined {
  return getProviderConfig(providerId).model || DEFAULTS[providerId]?.model;
}

export function effectiveBaseUrl(providerId: string): string | undefined {
  return getProviderConfig(providerId).baseUrl || DEFAULTS[providerId]?.baseUrl;
}
