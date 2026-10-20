import { ProviderError } from './types.ts';
import { redactSecrets } from './redact.ts';

interface GoogleErrorInfo {
  httpStatus: number;
  googleStatus: string | null;
  message: string;
  quotaIds: string[];
  retryDelaySeconds: number | null;
}

function parseDelay(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(value);
  return match ? Number(match[1]) : null;
}

export function parseGoogleError(err: any): GoogleErrorInfo {
  const raw = String(err?.message ?? err ?? '');
  let body: any = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }
  const inner = body?.error ?? null;
  const details: any[] = Array.isArray(inner?.details) ? inner.details : [];
  const quotaIds: string[] = [];
  let retryDelaySeconds: number | null = null;
  for (const detail of details) {
    const type = String(detail?.['@type'] ?? '');
    if (type.endsWith('QuotaFailure') && Array.isArray(detail.violations)) {
      for (const violation of detail.violations) {
        if (violation?.quotaId) quotaIds.push(String(violation.quotaId));
      }
    }
    if (type.endsWith('RetryInfo')) retryDelaySeconds = parseDelay(detail.retryDelay);
  }
  const httpStatus = Number(err?.status ?? inner?.code ?? err?.code);
  return {
    httpStatus: Number.isFinite(httpStatus) ? httpStatus : 0,
    googleStatus: typeof inner?.status === 'string' ? inner.status : /RESOURCE_EXHAUSTED/.test(raw) ? 'RESOURCE_EXHAUSTED' : null,
    message: String(inner?.message ?? raw),
    quotaIds,
    retryDelaySeconds,
  };
}

function snippet(info: GoogleErrorInfo, credential?: string): string {
  const parts = [info.httpStatus ? String(info.httpStatus) : null, info.googleStatus].filter(Boolean).join(' ');
  const reason = redactSecrets(info.message, credential ? [credential] : []).replace(/\s+/g, ' ').slice(0, 160);
  return `Google: ${parts ? `${parts}, ` : ''}${reason}`;
}

function isTemporaryLimit(info: GoogleErrorInfo): boolean {
  const text = info.message.toLowerCase();
  const permanentQuota = info.quotaIds.some(id => /perday|freetier/i.test(id)) || /limit:\s*0|free.?tier|per.?day/.test(text);
  if (permanentQuota) return false;
  if (info.quotaIds.some(id => /perminute|persecond/i.test(id))) return true;
  return info.retryDelaySeconds !== null && info.retryDelaySeconds <= 120;
}

export function toVeoError(err: any, credential?: string): ProviderError {
  if (err instanceof ProviderError) return err;
  const info = parseGoogleError(err);
  const text = `${info.googleStatus ?? ''} ${info.message}`.toLowerCase();
  const detail = snippet(info, credential);

  if (info.httpStatus === 401 || info.httpStatus === 403 || /api key not valid|api_key_invalid|permission_denied|unauthenticated/.test(text)) {
    return new ProviderError('AUTH_FAILED', `API key Gemini không hợp lệ hoặc không có quyền dùng Veo (${detail})`, false);
  }
  if (info.httpStatus === 429 || info.googleStatus === 'RESOURCE_EXHAUSTED') {
    if (isTemporaryLimit(info)) {
      return new ProviderError('RATE_LIMITED', `Veo báo giới hạn tốc độ tạm thời, hệ thống nghỉ 60 giây rồi thử lại (${detail})`, true);
    }
    return new ProviderError(
      'QUOTA_EXHAUSTED',
      `Dự án Google của khóa này chưa có hạn mức Veo, kiểm tra đã bật thanh toán chưa (${detail})`,
      false,
    );
  }
  if (info.httpStatus === 404 || info.googleStatus === 'NOT_FOUND') {
    return new ProviderError('MODEL_UNAVAILABLE', `Model Veo không tồn tại hoặc dự án chưa được cấp quyền dùng model này, kiểm tra tên model ở trang Quản trị (${detail})`, false);
  }
  if (info.httpStatus === 400) {
    return new ProviderError('INVALID_REQUEST', `Veo từ chối yêu cầu (${detail})`, false);
  }
  return new ProviderError('PROVIDER_ERROR', `Lỗi từ Veo (${detail})`, true);
}
