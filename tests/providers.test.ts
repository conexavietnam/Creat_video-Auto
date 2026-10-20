import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';

process.env.KLING_BASE_URL = 'http://127.0.0.1:39871';
process.env.CREDENTIAL_KEY ??= '00'.repeat(32);

const { toVeoError } = await import('../src/server/providers/veoErrors.ts');
const { klingProvider } = await import('../src/server/providers/kling.ts');
const { imageSize, nearestAspectRatio } = await import('../src/server/providers/imageSize.ts');
const { redactSecrets } = await import('../src/server/providers/redact.ts');
const { ProviderError } = await import('../src/server/providers/types.ts');

const googleError = (status: number, body: Record<string, unknown>) => Object.assign(new Error(JSON.stringify({ error: body })), { status });

describe('W1-A 4b: phân loại lỗi Veo', () => {
  it('429 RESOURCE_EXHAUSTED do thiếu hạn mức/thanh toán là QUOTA_EXHAUSTED, không retry', () => {
    const err = toVeoError(googleError(429, { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota, please check your plan and billing details.' }));
    assert.equal(err.code, 'QUOTA_EXHAUSTED');
    assert.equal(err.retryable, false);
    assert.match(err.message, /chưa có hạn mức Veo, kiểm tra đã bật thanh toán chưa/);
    assert.match(err.message, /429 RESOURCE_EXHAUSTED/);
  });

  it('giới hạn theo phút (quotaId PerMinute) là RATE_LIMITED, retry được', () => {
    const err = toVeoError(
      googleError(429, {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'Quota exceeded for metric',
        details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateVideosRequestsPerMinutePerProjectPerModel' }] }],
      }),
    );
    assert.equal(err.code, 'RATE_LIMITED');
    assert.equal(err.retryable, true);
  });

  it('hạn mức theo ngày hoặc gói miễn phí vẫn là QUOTA_EXHAUSTED dù có RetryInfo', () => {
    const err = toVeoError(
      googleError(429, {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'You exceeded your current quota',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '30s' },
        ],
      }),
    );
    assert.equal(err.code, 'QUOTA_EXHAUSTED');
  });

  it('chữ "generate" trong thông điệp không còn bị nhầm thành giới hạn tốc độ', () => {
    const err = toVeoError(googleError(500, { code: 500, status: 'INTERNAL', message: 'Failed to generate video, please try again' }));
    assert.equal(err.code, 'PROVIDER_ERROR');
    assert.equal(err.retryable, true);
  });

  it('khóa sai, model không có, tham số sai', () => {
    assert.equal(toVeoError(googleError(400, { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' })).code, 'AUTH_FAILED');
    assert.equal(toVeoError(googleError(403, { code: 403, status: 'PERMISSION_DENIED', message: 'denied' })).code, 'AUTH_FAILED');
    const missing = toVeoError(googleError(404, { code: 404, status: 'NOT_FOUND', message: 'models/veo-x is not found' }));
    assert.equal(missing.code, 'MODEL_UNAVAILABLE');
    assert.equal(missing.retryable, false);
    assert.equal(toVeoError(googleError(400, { code: 400, status: 'INVALID_ARGUMENT', message: 'duration must be 8' })).code, 'INVALID_REQUEST');
  });

  it('không để lộ khóa trong thông báo lỗi', () => {
    const key = 'AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q';
    const err = toVeoError(googleError(400, { code: 400, status: 'INVALID_ARGUMENT', message: `Bad request for key=${key} and other-secret-123` }), 'other-secret-123');
    assert.ok(!err.message.includes(key));
    assert.ok(!err.message.includes('other-secret-123'));
  });

  it('lỗi không phải JSON vẫn phân loại được', () => {
    const err = toVeoError(Object.assign(new Error('429 RESOURCE_EXHAUSTED: exceeded your current quota'), { status: 429 }));
    assert.equal(err.code, 'QUOTA_EXHAUSTED');
  });
});

describe('redactSecrets', () => {
  it('che khóa Google và chuỗi bí mật truyền vào', () => {
    assert.equal(redactSecrets('abc XYZSECRET def', ['XYZSECRET']), 'abc [đã ẩn] def');
    assert.ok(!redactSecrets('key AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q').includes('AIza'));
  });
});

function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function jpeg(width: number, height: number): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]), sof]);
}

function webpX(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.write('RIFF', 0, 'ascii');
  buffer.write('WEBP', 8, 'ascii');
  buffer.write('VP8X', 12, 'ascii');
  buffer.writeUIntLE(width - 1, 24, 3);
  buffer.writeUIntLE(height - 1, 27, 3);
  return buffer;
}

describe('đọc kích thước ảnh', () => {
  it('PNG, JPEG, WebP', () => {
    assert.deepEqual(imageSize(png(1280, 720)), { width: 1280, height: 720 });
    assert.deepEqual(imageSize(jpeg(720, 1280)), { width: 720, height: 1280 });
    assert.deepEqual(imageSize(webpX(1024, 1024)), { width: 1024, height: 1024 });
    assert.equal(imageSize(Buffer.from('không phải ảnh')), null);
  });

  it('tỉ lệ gần nhất', () => {
    const all = ['16:9', '9:16', '1:1'];
    assert.equal(nearestAspectRatio({ width: 1920, height: 1080 }, all), '16:9');
    assert.equal(nearestAspectRatio({ width: 1080, height: 1920 }, all), '9:16');
    assert.equal(nearestAspectRatio({ width: 1000, height: 1050 }, all), '1:1');
  });
});

describe('W1-A 4: Kling image-to-video lấy tỉ lệ theo ảnh', () => {
  const submitInput = (bytes: Buffer, aspectRatio: string) => ({
    jobId: 'task_x',
    prompt: 'p',
    duration: 5,
    aspectRatio,
    refImages: [{ tag: 'a', bytes, mimeType: 'image/png' }],
  });

  it('ảnh ngang mà chọn 9:16 bị từ chối kèm lời giải thích rõ', () => {
    const message = klingProvider.validate(submitInput(png(1280, 720), '9:16'));
    assert.match(message ?? '', /lấy tỉ lệ theo ảnh đầu vào/);
    assert.match(message ?? '', /16:9/);
  });

  it('ảnh khớp tỉ lệ thì cho qua; ảnh quá nhỏ bị chặn; ảnh không đọc được thì không chặn', () => {
    assert.equal(klingProvider.validate(submitInput(png(1280, 720), '16:9')), null);
    assert.match(klingProvider.validate(submitInput(png(200, 200), '1:1')) ?? '', /300×300/);
    assert.equal(klingProvider.validate(submitInput(Buffer.from('xyz'), '9:16')), null);
  });

  it('không có ảnh (text-to-video) thì không kiểm tra tỉ lệ', () => {
    assert.equal(klingProvider.validate({ jobId: 'j', prompt: 'p', duration: 5, aspectRatio: '9:16', refImages: [] }), null);
  });
});

describe('W1-A 2: Kling báo lỗi tạm thời đúng dạng để dispatcher giữ job', () => {
  let server: http.Server;
  let mode = '200';

  before(async () => {
    server = http.createServer((req, res) => {
      if (mode === '503') {
        res.statusCode = 503;
        return res.end('Service Unavailable');
      }
      if (mode === '429') {
        res.statusCode = 429;
        return res.end('{}');
      }
      if (mode === 'html') {
        res.setHeader('content-type', 'text/html');
        return res.end('<html>lỗi</html>');
      }
      if (mode === 'drop') return req.socket.destroy();
      res.setHeader('content-type', 'application/json');
      res.end('{"code":0,"data":{"task_status":"processing"}}');
    });
    await new Promise<void>(resolve => server.listen(39871, '127.0.0.1', resolve));
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  const credential = 'accessKeyX:secretKeyY';

  it('poll bình thường', async () => {
    mode = '200';
    assert.deepEqual(await klingProvider.poll(credential, 't2v:abc'), { state: 'running', stage: 'processing' });
  });

  it('503, 429, HTML, mất kết nối: đều ném ProviderError (không phải trạng thái failed của job)', async () => {
    for (const next of ['503', '429', 'html', 'drop']) {
      mode = next;
      await assert.rejects(() => klingProvider.poll(credential, 't2v:abc'), (err: unknown) => err instanceof ProviderError, `chế độ ${next}`);
    }
  });

  it('health mất kết nối trả code NETWORK/PROVIDER_ERROR (không phải AUTH_FAILED)', async () => {
    mode = 'drop';
    const result = await klingProvider.health(credential);
    assert.equal(result.ok, false);
    assert.notEqual(result.code, 'AUTH_FAILED');
  });

  it('thông báo lỗi không chứa khóa bí mật', async () => {
    mode = 'drop';
    try {
      await klingProvider.poll(credential, 't2v:abc');
    } catch (err: any) {
      assert.ok(!err.message.includes('secretKeyY'));
    }
  });
});
