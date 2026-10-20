import { ProviderError, VideoProvider } from './types.ts';

const reason = 'Google Flow chưa có API chính thức; adapter phiên trình duyệt chưa được triển khai';

export const flowProvider: VideoProvider = {
  id: 'flow',
  label: 'Google Flow (phiên trình duyệt)',
  kind: 'browser_session',
  credentialHint: 'Chưa hỗ trợ',
  available: false,
  unavailableReason: reason,
  capabilities: {
    durations: [8],
    aspectRatios: ['16:9', '9:16'],
    maxRefImages: 3,
    supportsImageToVideo: true,
  },
  pollIntervalMs: 10000,
  validate: () => reason,
  async health() {
    return { ok: false, reason };
  },
  async submit() {
    throw new ProviderError('PROVIDER_UNAVAILABLE', reason, false);
  },
  async poll() {
    throw new ProviderError('PROVIDER_UNAVAILABLE', reason, false);
  },
  async cancel() {},
};
