import { AppSettings, ProviderInfo } from './types';

export const MENTION_PATTERN = /(?<![\w@])@([a-z0-9][a-z0-9_-]*)/gi;

export function extractTags(text: string): string[] {
  const tags: string[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const tag = match[1].toLowerCase();
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

export async function loadProviders(): Promise<ProviderInfo[]> {
  const res = await fetch('/api/providers');
  const json = await res.json();
  return json.success ? json.data : [];
}

export async function loadSettings(): Promise<AppSettings | null> {
  const res = await fetch('/api/settings');
  const json = await res.json();
  return json.success ? json.data : null;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings | null> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const json = await res.json();
  return json.success ? json.data : null;
}

export function pickProvider(providers: ProviderInfo[], preferred: string | undefined, withAccounts: Set<string>): ProviderInfo | undefined {
  const usable = providers.filter(p => p.available);
  return (
    usable.find(p => p.id === preferred) ||
    usable.find(p => withAccounts.has(p.id)) ||
    usable[0]
  );
}

export function fitOption<T>(current: T, allowed: T[]): T {
  return allowed.includes(current) ? current : allowed[0];
}
