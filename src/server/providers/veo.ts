import { GoogleGenAI, GenerateVideosOperation } from '@google/genai';
import { ProviderError, VideoProvider, SubmitInput } from './types.ts';
import { effectiveModel } from '../providerConfig.ts';
import { toVeoError } from './veoErrors.ts';

const model = () => effectiveModel('veo') as string;

function client(apiKey: string) {
  return new GoogleGenAI({ apiKey });
}

export const veoProvider: VideoProvider = {
  id: 'veo',
  label: 'Google Veo (Gemini API)',
  kind: 'api_key',
  credentialHint: 'Gemini API key',
  available: true,
  capabilities: {
    durations: [4, 6, 8],
    aspectRatios: ['16:9', '9:16'],
    maxRefImages: 3,
    supportsImageToVideo: true,
  },
  pollIntervalMs: 10000,
  validate(input: SubmitInput) {
    if (input.inputImage && input.refImages.length > 0) {
      return 'Veo không hỗ trợ dùng đồng thời ảnh đầu khung và ảnh tham chiếu @tag';
    }
    if (input.refImages.length > 0 && (input.duration !== 8 || input.aspectRatio !== '16:9')) {
      return 'Veo chỉ cho phép ảnh tham chiếu @tag với thời lượng 8 giây và tỉ lệ 16:9';
    }
    return null;
  },
  async health(credential) {
    try {
      await client(credential).models.get({ model: model() });
      return { ok: true, reason: 'API key hợp lệ, kết nối Gemini API ổn định' };
    } catch (err) {
      const e = toVeoError(err, credential);
      return { ok: false, reason: e.message, code: e.code };
    }
  },
  async submit(credential, input) {
    try {
      const encode = (img: { bytes: Buffer; mimeType: string }) => ({
        imageBytes: img.bytes.toString('base64'),
        mimeType: img.mimeType,
      });
      const config: Record<string, unknown> = {
        aspectRatio: input.aspectRatio,
        durationSeconds: input.duration,
        numberOfVideos: 1,
      };
      if (input.refImages.length > 0) {
        config.referenceImages = input.refImages.map(img => ({ image: encode(img), referenceType: 'ASSET' }));
      }
      const operation = await client(credential).models.generateVideos({
        model: model(),
        prompt: input.prompt,
        image: input.inputImage ? encode(input.inputImage) : undefined,
        config,
      });
      if (!operation.name) {
        throw new ProviderError('PROVIDER_ERROR', 'Veo không trả về mã thao tác', true);
      }
      return { externalId: operation.name };
    } catch (err) {
      throw toVeoError(err, credential);
    }
  },
  async poll(credential, externalId) {
    try {
      const seed = new GenerateVideosOperation();
      seed.name = externalId;
      const operation = await client(credential).operations.getVideosOperation({ operation: seed });
      if (!operation.done) {
        return { state: 'running', stage: 'processing' };
      }
      if (operation.error) {
        return {
          state: 'failed',
          code: 'PROVIDER_ERROR',
          message: `Veo báo lỗi: ${String((operation.error as any).message || JSON.stringify(operation.error)).slice(0, 200)}`,
          retryable: true,
        };
      }
      const response = operation.response;
      const uri = response?.generatedVideos?.[0]?.video?.uri;
      if (!uri) {
        const reasons = (response?.raiMediaFilteredReasons || []).join('; ');
        return {
          state: 'failed',
          code: 'CONTENT_FILTERED',
          message: `Veo từ chối nội dung${reasons ? `: ${reasons}` : ''}`,
          retryable: false,
        };
      }
      return { state: 'done', video: { url: uri, headers: { 'x-goog-api-key': credential } } };
    } catch (err) {
      throw toVeoError(err, credential);
    }
  },
  async cancel() {},
};
