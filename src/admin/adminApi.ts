import type {
  AdminMe,
  AdminProvider,
  AdminSettings,
  AdminStats,
  AdminAccount,
  ApiResult,
  AuditPage,
  ProviderPatch,
  SettingsPatch,
} from './types';

export function mockMode(): string | null {
  if (!import.meta.env.DEV) return null;
  return new URLSearchParams(window.location.search).get('mock');
}

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  if (import.meta.env.DEV) {
    const mode = mockMode();
    if (mode) {
      const { mockCall } = await import('./mock');
      return mockCall<T>(method, path, body, mode);
    }
  }
  try {
    const res = await fetch(`/api/admin${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
    if (res.status === 401) window.dispatchEvent(new Event('muse:unauthorized'));
    const json = await res.json().catch(() => null);
    if (res.ok && json?.success) return { ok: true, data: json.data as T };
    return { ok: false, status: res.status, error: json?.error || `Yêu cầu thất bại (mã ${res.status})` };
  } catch {
    return { ok: false, status: 0, error: 'Không kết nối được máy chủ, vui lòng thử lại' };
  }
}

export const adminApi = {
  me: () => call<AdminMe>('GET', '/me'),
  providers: () => call<AdminProvider[]>('GET', '/providers'),
  updateProvider: (id: string, patch: ProviderPatch) => call<AdminProvider>('PUT', `/providers/${encodeURIComponent(id)}`, patch),
  addAccount: (providerId: string, body: { name: string; credential: string; maxSlots: number }) =>
    call<AdminAccount>('POST', `/providers/${encodeURIComponent(providerId)}/accounts`, body),
  rotateCredential: (accountId: number, credential: string) => call<AdminAccount>('PUT', `/accounts/${accountId}/credential`, { credential }),
  patchAccount: (accountId: number, patch: { name?: string; maxSlots?: number; isEnabled?: boolean }) =>
    call<AdminAccount>('PATCH', `/accounts/${accountId}`, patch),
  deleteAccount: (accountId: number) => call<null>('DELETE', `/accounts/${accountId}`),
  checkHealth: (accountId: number) => call<AdminAccount>('POST', `/accounts/${accountId}/health`),
  settings: () => call<AdminSettings>('GET', '/settings'),
  saveSettings: (patch: SettingsPatch) => call<AdminSettings>('PUT', '/settings', patch),
  stats: (from?: string, to?: string) => {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    const qs = query.toString();
    return call<AdminStats>('GET', `/stats${qs ? `?${qs}` : ''}`);
  },
  audit: (before?: number) => call<AuditPage>('GET', `/audit?limit=50${before ? `&before=${before}` : ''}`),
};
