import type {
  AdminAccount,
  AdminProvider,
  AdminSettings,
  AdminStats,
  ApiResult,
  AuditItem,
  ProviderPatch,
  SettingsPatch,
} from './types';

const NOW = Date.now();
const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data });
const fail = <T,>(status: number, error: string): ApiResult<T> => ({ ok: false, status, error });

const account = (id: number, name: string, mask: string, online: boolean, slots: number, running: number, reason: string): AdminAccount => ({
  id,
  name,
  maskedIdentifier: mask,
  isEnabled: true,
  sessionStatus: online ? 'online' : 'offline',
  healthReason: reason,
  maxSlots: slots,
  currentRunningJobs: running,
  lastHealthCheck: iso(1),
});

const providers: AdminProvider[] = [
  {
    id: 'veo',
    label: 'Google Veo (Gemini API)',
    kind: 'api_key',
    credentialHint: 'Gemini API key',
    available: true,
    unavailableReason: null,
    capabilities: { durations: [4, 6, 8], aspectRatios: ['16:9', '9:16'], maxRefImages: 3, supportsImageToVideo: true },
    settings: { enabled: true, model: null, baseUrl: null, pricePerSecondUsd: 0.4, notes: 'Dự án Marketing', effectiveModel: 'veo-3.1-generate-preview' },
    accounts: [
      account(1, 'Veo chính', 'usr_***a91c', true, 2, 1, 'API key hợp lệ, kết nối Gemini API ổn định'),
      account(2, 'Veo dự phòng', 'usr_***03fe', false, 1, 0, 'API key Gemini không hợp lệ hoặc không có quyền dùng Veo'),
    ],
  },
  {
    id: 'kling',
    label: 'Kling AI (API)',
    kind: 'api_key',
    credentialHint: 'accessKey:secretKey',
    available: true,
    unavailableReason: null,
    capabilities: { durations: [5, 10], aspectRatios: ['16:9', '9:16', '1:1'], maxRefImages: 1, supportsImageToVideo: true },
    settings: { enabled: true, model: 'kling-v2-master', baseUrl: 'https://api.klingai.com', pricePerSecondUsd: null, notes: null, effectiveModel: 'kling-v2-master' },
    accounts: [account(3, 'Kling nhóm A', 'usr_***77b2', true, 1, 0, 'Khóa Kling hợp lệ, kết nối ổn định')],
  },
  {
    id: 'flow',
    label: 'Google Flow (phiên trình duyệt)',
    kind: 'browser_session',
    credentialHint: 'Chưa hỗ trợ',
    available: false,
    unavailableReason: 'Google Flow chưa có API chính thức; adapter phiên trình duyệt chưa được triển khai',
    capabilities: { durations: [8], aspectRatios: ['16:9', '9:16'], maxRefImages: 3, supportsImageToVideo: true },
    settings: { enabled: true, model: null, baseUrl: null, pricePerSecondUsd: null, notes: null, effectiveModel: null },
    accounts: [],
  },
];

let settings: AdminSettings = {
  id: 1,
  concurrencyLimit: 3,
  maxRetries: 2,
  timeoutMinutes: 15,
  autoEnqueueOnPaste: true,
  defaultDuration: 8,
  defaultAspectRatio: '16:9',
  defaultProviderId: 'auto',
  updatedAt: iso(300),
};

let nextAccountId = 10;
let nextAuditId = 6;
const audit: AuditItem[] = [
  { id: 5, at: iso(30), actorVaid: '1', action: 'provider.update', target: 'veo', detail: { before: { pricePerSecondUsd: null }, after: { pricePerSecondUsd: 0.4 } } },
  { id: 4, at: iso(95), actorVaid: '1', action: 'account.rotate', target: 'veo#2', detail: { before: { maskedIdentifier: 'usr_***11aa' }, after: { maskedIdentifier: 'usr_***03fe', sessionStatus: 'offline' } } },
  { id: 3, at: iso(600), actorVaid: '1', action: 'settings.update', target: 'app_settings', detail: { before: { concurrencyLimit: 2 }, after: { concurrencyLimit: 3 } } },
  { id: 2, at: iso(1500), actorVaid: '1', action: 'account.add', target: 'kling#3', detail: { after: { name: 'Kling nhóm A', maxSlots: 1, maskedIdentifier: 'usr_***77b2' } } },
  { id: 1, at: iso(1600), actorVaid: '1', action: 'account.add', target: 'veo#1', detail: { after: { name: 'Veo chính', maxSlots: 2, maskedIdentifier: 'usr_***a91c' } } },
];

function record(action: string, target: string, detail: unknown) {
  audit.unshift({ id: nextAuditId++, at: new Date().toISOString(), actorVaid: '1', action, target, detail });
}

function findAccount(id: number) {
  for (const provider of providers) {
    const found = provider.accounts.find(a => a.id === id);
    if (found) return { provider, found };
  }
  return null;
}

function buildStats(from?: string | null, to?: string | null): ApiResult<AdminStats> {
  const end = to ? new Date(`${to}T00:00:00Z`) : new Date();
  const start = from ? new Date(`${from}T00:00:00Z`) : new Date(end.getTime() - 29 * 86_400_000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return fail(400, 'Ngày không hợp lệ');
  if (start > end) return fail(400, 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days > 365) return fail(400, 'Khoảng thống kê tối đa 365 ngày');

  const perDay = Array.from({ length: days }, (_, i) => {
    const date = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    const created = 6 + ((i * 7) % 13);
    const failed = (i * 3) % 4;
    return { date, created, completed: Math.max(0, created - failed - (i % 3)), failed };
  });
  const sum = (key: 'created' | 'completed' | 'failed') => perDay.reduce((s, d) => s + d[key], 0);
  const completed = sum('completed');
  const failed = sum('failed');

  return ok({
    range: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) },
    totals: { jobs: sum('created'), completed, failed, stopped: 2, pending: 4, running: 2, successRate: completed + failed > 0 ? completed / (completed + failed) : null },
    perDay,
    perProvider: [
      { providerId: 'veo', jobs: Math.round(sum('created') * 0.6), completed: Math.round(completed * 0.6), failed: Math.round(failed * 0.5), successRate: 0.93, videoSeconds: Math.round(completed * 0.6) * 8, estimatedCostUsd: Math.round(completed * 0.6) * 8 * 0.4, avgCompleteSeconds: 214.5, p95CompleteSeconds: 402 },
      { providerId: 'kling', jobs: Math.round(sum('created') * 0.4), completed: Math.round(completed * 0.4), failed: Math.round(failed * 0.5), successRate: 0.88, videoSeconds: Math.round(completed * 0.4) * 5, estimatedCostUsd: null, avgCompleteSeconds: 96.2, p95CompleteSeconds: 188 },
      { providerId: 'flow', jobs: 0, completed: 0, failed: 0, successRate: null, videoSeconds: 0, estimatedCostUsd: null, avgCompleteSeconds: null, p95CompleteSeconds: null },
    ],
    perAccount: [
      { accountId: 1, name: 'Veo chính', providerId: 'veo', jobs: 120, completed: 112, failed: 8 },
      { accountId: 3, name: 'Kling nhóm A', providerId: 'kling', jobs: 80, completed: 70, failed: 10 },
      { accountId: 9, name: null, providerId: 'veo', jobs: 5, completed: 5, failed: 0 },
    ],
    topErrors: [
      { errorCode: 'CONTENT_FILTERED', count: 9, lastMessage: 'Veo từ chối nội dung: nội dung nhạy cảm' },
      { errorCode: 'TIMEOUT', count: 5, lastMessage: 'Job không có tiến độ mới quá 15 phút nên bị đánh dấu timeout' },
      { errorCode: 'RATE_LIMITED', count: 2, lastMessage: 'Kling báo vượt giới hạn tốc độ hoặc số tác vụ đồng thời' },
    ],
    queue: { pending: 4, running: 2, oldestPendingAgeSeconds: 754 },
    retries: { jobsWithRetry: 11, totalExtraAttempts: 17 },
  });
}

export async function mockCall<T>(method: string, path: string, body: any, mode: string): Promise<ApiResult<T>> {
  await new Promise(resolve => setTimeout(resolve, 120));
  const url = new URL(path, 'http://mock');
  const route = url.pathname;
  const respond = (result: ApiResult<unknown>) => result as ApiResult<T>;

  if (mode === 'denied') return fail(404, 'Không tìm thấy');
  if (route === '/me') return respond(ok({ vaid: '1', name: 'info@vaway.vn' }));

  if (route === '/providers' && method === 'GET') return respond(ok(structuredClone(providers)));

  let match = /^\/providers\/([^/]+)$/.exec(route);
  if (match && method === 'PUT') {
    const provider = providers.find(p => p.id === match![1]);
    if (!provider) return fail(404, 'Nền tảng không tồn tại');
    const patch = body as ProviderPatch;
    if (patch.baseUrl && !patch.baseUrl.startsWith('https://')) return fail(400, 'Base URL phải bắt đầu bằng https://');
    const before = { ...provider.settings };
    Object.assign(provider.settings, patch);
    provider.available = provider.id === 'flow' ? false : provider.settings.enabled;
    provider.unavailableReason = provider.id === 'flow' ? provider.unavailableReason : provider.settings.enabled ? null : 'Đã bị quản trị viên tắt';
    provider.settings.effectiveModel = provider.settings.model || (provider.id === 'veo' ? 'veo-3.1-generate-preview' : provider.id === 'kling' ? 'kling-v2-master' : null);
    record('provider.update', provider.id, { before, after: { ...provider.settings } });
    return respond(ok(structuredClone(provider)));
  }

  match = /^\/providers\/([^/]+)\/accounts$/.exec(route);
  if (match && method === 'POST') {
    const provider = providers.find(p => p.id === match![1]);
    if (!provider) return fail(400, 'Nền tảng không tồn tại');
    if (!provider.available) return fail(400, `Nền tảng ${provider.label} chưa khả dụng`);
    if (!body.name?.trim() || !body.credential?.trim()) return fail(400, 'Cần tên (1-80 ký tự) và credential hợp lệ');
    const created = account(nextAccountId++, body.name.trim(), `usr_***${Math.random().toString(16).slice(2, 6)}`, true, body.maxSlots || 1, 0, 'Khóa hợp lệ');
    provider.accounts.push(created);
    record('account.add', `${provider.id}#${created.id}`, { after: { name: created.name, maxSlots: created.maxSlots, maskedIdentifier: created.maskedIdentifier } });
    return respond(ok(structuredClone(created)));
  }

  match = /^\/accounts\/(\d+)(\/credential|\/health)?$/.exec(route);
  if (match) {
    const hit = findAccount(Number(match[1]));
    if (!hit) return fail(404, 'Không tìm thấy tài khoản');
    const { provider, found } = hit;
    if (match[2] === '/credential' && method === 'PUT') {
      if (!body.credential?.trim()) return fail(400, 'Credential không hợp lệ');
      const before = found.maskedIdentifier;
      found.maskedIdentifier = `usr_***${Math.random().toString(16).slice(2, 6)}`;
      found.sessionStatus = 'online';
      found.healthReason = 'Khóa hợp lệ';
      record('account.rotate', `${provider.id}#${found.id}`, { before: { maskedIdentifier: before }, after: { maskedIdentifier: found.maskedIdentifier } });
      return respond(ok(structuredClone(found)));
    }
    if (match[2] === '/health' && method === 'POST') {
      found.lastHealthCheck = new Date().toISOString();
      return respond(ok(structuredClone(found)));
    }
    if (!match[2] && method === 'PATCH') {
      const before = { name: found.name, maxSlots: found.maxSlots, isEnabled: found.isEnabled };
      Object.assign(found, body);
      record('account.update', `${provider.id}#${found.id}`, { before, after: { name: found.name, maxSlots: found.maxSlots, isEnabled: found.isEnabled } });
      return respond(ok(structuredClone(found)));
    }
    if (!match[2] && method === 'DELETE') {
      provider.accounts = provider.accounts.filter(a => a.id !== found.id);
      record('account.delete', `${provider.id}#${found.id}`, { before: { name: found.name, maskedIdentifier: found.maskedIdentifier } });
      return respond(ok(null));
    }
  }

  if (route === '/settings' && method === 'GET') return respond(ok({ ...settings }));
  if (route === '/settings' && method === 'PUT') {
    const patch = body as SettingsPatch;
    const before = { ...settings };
    settings = { ...settings, ...patch, updatedAt: new Date().toISOString() };
    record('settings.update', 'app_settings', { before: Object.fromEntries(Object.keys(patch).map(k => [k, (before as any)[k]])), after: patch });
    return respond(ok({ ...settings }));
  }

  if (route === '/stats' && method === 'GET') return respond(buildStats(url.searchParams.get('from'), url.searchParams.get('to')));

  if (route === '/audit' && method === 'GET') {
    const limit = Number(url.searchParams.get('limit') || 50);
    const before = url.searchParams.get('before');
    const pool = before ? audit.filter(a => a.id < Number(before)) : audit;
    const items = pool.slice(0, limit);
    return respond(ok({ items, nextBefore: pool.length > limit ? items[items.length - 1].id : null }));
  }

  return fail(404, 'Không tìm thấy');
}
