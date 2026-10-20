import { ProviderError, VideoProvider } from './types.ts';

const SAMPLE_VIDEO = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';

export const mockProvider: VideoProvider = {
  id: 'mock',
  label: 'Mô phỏng (demo, không tạo video thật)',
  kind: 'demo',
  credentialHint: 'Nhập bất kỳ chuỗi nào',
  available: process.env.ENABLE_MOCK_PROVIDER !== 'false',
  unavailableReason: 'Provider mô phỏng đã bị tắt bằng ENABLE_MOCK_PROVIDER=false',
  capabilities: {
    durations: [5, 10, 15],
    aspectRatios: ['9:16', '16:9', '1:1'],
    maxRefImages: 5,
    supportsImageToVideo: true,
  },
  pollIntervalMs: 2000,
  validate: () => null,
  async health(credential) {
    if (!credential.trim()) return { ok: false, reason: 'Credential rỗng' };
    return { ok: true, reason: 'Phiên mô phỏng hoạt động bình thường' };
  },
  async submit(_credential, input) {
    if (/\[fail\]/i.test(input.prompt)) {
      throw new ProviderError('MOCK_FAILURE', 'Prompt chứa [fail] nên bị từ chối (dùng để kiểm thử retry)', true);
    }
    const mode = /\[hang\]/i.test(input.prompt) ? 'hang' : 'run';
    return { externalId: `mock:${Date.now()}:${input.duration}:${mode}` };
  },
  async poll(_credential, externalId) {
    const [, startedAt, duration, mode] = externalId.split(':');
    if (mode === 'hang') return { state: 'running', progress: 10, stage: 'stuck' };
    const elapsed = (Date.now() - Number(startedAt)) / 1000;
    const total = Math.max(3, Number(duration) * 0.6);
    if (elapsed >= total) {
      return { state: 'done', video: { url: SAMPLE_VIDEO, remoteOnly: true } };
    }
    return { state: 'running', progress: Math.min(95, Math.max(5, Math.floor((elapsed / total) * 100))) };
  },
  async cancel() {},
};
