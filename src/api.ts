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

export interface AuthInfo {
  required: boolean;
  authenticated: boolean;
  unavailable: boolean;
  user: { name: string } | null;
  vaid: { appId: string; loaderUrl: string } | null;
}

export async function loadAuthStatus(): Promise<AuthInfo | null> {
  const res = await fetch('/api/auth/status', { cache: 'no-store' });
  const json = await res.json();
  return json.success ? json.data : null;
}

const VAID_ERRORS: Record<string, string> = {
  denied: 'Tài khoản này chưa được cấp quyền vào hệ thống.',
  unavailable: 'Chưa xác minh được với VAWAY ID, vui lòng thử lại sau.',
  disabled: 'Đăng nhập VAWAY ID đang tạm thời không khả dụng.',
  busy: 'Thao tác quá nhanh, vui lòng thử lại sau ít phút.',
  invalid: 'Phiên đăng nhập đã hết hạn, vui lòng thử lại.',
  storage: 'Trình duyệt đang chặn lưu dữ liệu, vui lòng bật lại để đăng nhập.',
};

export function vaidErrorMessage(code?: string): string {
  return (code && VAID_ERRORS[code]) || 'Đăng nhập không thành công, vui lòng thử lại.';
}

export function consumeAuthHash(): string | null {
  const hash = window.location.hash;
  if (!hash.includes('vaid_')) return null;
  const error = /vaid_error=([a-z_]+)/.exec(hash)?.[1];
  const signedOut = hash.includes('vaid_signout=1');
  window.history.replaceState({}, '', window.location.pathname + window.location.search);
  if (error) return vaidErrorMessage(error);
  return signedOut ? 'Bạn đã đăng xuất khỏi VAWAY ID.' : null;
}

export function loadVaidLoader(url: string) {
  if (document.querySelector('script[data-vaid-loader]')) return;
  const script = document.createElement('script');
  script.src = url;
  script.async = true;
  script.dataset.vaidLoader = '1';
  document.head.appendChild(script);
}

export async function logout() {
  let target: string | null = null;
  try {
    const res = await fetch('/api/auth/logout', { method: 'POST' });
    const json = await res.json();
    target = json?.data?.globalSignoutUrl || null;
  } catch {
    target = null;
  }
  window.location.href = target || '/';
}
