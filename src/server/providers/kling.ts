import crypto from 'crypto';
import { ProviderError, VideoProvider } from './types.ts';

const BASE_URL = process.env.KLING_BASE_URL || 'https://api.klingai.com';
const MODEL = process.env.KLING_MODEL || 'kling-v2-master';

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

function signToken(credential: string): string {
  const separator = credential.indexOf(':');
  if (separator < 1) {
    throw new ProviderError('AUTH_FAILED', 'Credential Kling phải có dạng accessKey:secretKey', false);
  }
  const accessKey = credential.slice(0, separator);
  const secretKey = credential.slice(separator + 1);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iss: accessKey, exp: now + 1800, nbf: now - 5 }));
  const signature = crypto.createHmac('sha256', secretKey).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

async function call(credential: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${signToken(credential)}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('AUTH_FAILED', 'Access key / secret key Kling không hợp lệ', false);
  }
  if (res.status === 429 || (json && [1302, 1303, 1304].includes(json.code))) {
    throw new ProviderError('RATE_LIMITED', 'Kling báo vượt giới hạn tốc độ hoặc số tác vụ đồng thời', true);
  }
  if (!res.ok || !json || json.code !== 0) {
    const detail = json?.message || text.slice(0, 200);
    const retryable = res.status >= 500;
    throw new ProviderError(retryable ? 'PROVIDER_ERROR' : 'INVALID_REQUEST', `Kling trả lỗi: ${detail}`, retryable);
  }
  return json.data;
}

export const klingProvider: VideoProvider = {
  id: 'kling',
  label: 'Kling AI (API)',
  kind: 'api_key',
  credentialHint: 'accessKey:secretKey',
  available: true,
  capabilities: {
    durations: [5, 10],
    aspectRatios: ['16:9', '9:16', '1:1'],
    maxRefImages: 1,
    supportsImageToVideo: true,
  },
  pollIntervalMs: 5000,
  validate(input) {
    if (input.inputImage && input.refImages.length > 0) {
      return 'Kling chỉ nhận một ảnh đầu vào, không dùng đồng thời ảnh đầu khung và ảnh tham chiếu @tag';
    }
    return null;
  },
  async health(credential) {
    try {
      await call(credential, 'GET', '/v1/videos/text2video?pageNum=1&pageSize=1');
      return { ok: true, reason: 'Khóa Kling hợp lệ, kết nối ổn định' };
    } catch (err: any) {
      return { ok: false, reason: err?.message || 'Không kết nối được Kling' };
    }
  },
  async submit(credential, input) {
    const image = input.inputImage || input.refImages[0];
    const common = {
      model_name: MODEL,
      prompt: input.prompt,
      duration: String(input.duration),
    };
    if (image) {
      const data = await call(credential, 'POST', '/v1/videos/image2video', {
        ...common,
        image: image.bytes.toString('base64'),
      });
      return { externalId: `i2v:${data.task_id}` };
    }
    const data = await call(credential, 'POST', '/v1/videos/text2video', {
      ...common,
      aspect_ratio: input.aspectRatio,
    });
    return { externalId: `t2v:${data.task_id}` };
  },
  async poll(credential, externalId) {
    const [kind, taskId] = externalId.split(':');
    const endpoint = kind === 'i2v' ? 'image2video' : 'text2video';
    const data = await call(credential, 'GET', `/v1/videos/${endpoint}/${taskId}`);
    if (data.task_status === 'succeed') {
      const url = data.task_result?.videos?.[0]?.url;
      if (!url) {
        return { state: 'failed', code: 'PROVIDER_ERROR', message: 'Kling báo xong nhưng không có video', retryable: true };
      }
      return { state: 'done', video: { url } };
    }
    if (data.task_status === 'failed') {
      return {
        state: 'failed',
        code: 'PROVIDER_ERROR',
        message: `Kling báo lỗi: ${data.task_status_msg || 'không rõ nguyên nhân'}`,
        retryable: true,
      };
    }
    return { state: 'running', stage: data.task_status };
  },
  async cancel() {},
};
