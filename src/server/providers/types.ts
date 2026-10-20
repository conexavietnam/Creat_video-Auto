export interface ProviderCapabilities {
  durations: number[];
  aspectRatios: string[];
  maxRefImages: number;
  supportsImageToVideo: boolean;
}

export interface ImageInput {
  tag?: string;
  bytes: Buffer;
  mimeType: string;
}

export interface SubmitInput {
  jobId: string;
  prompt: string;
  duration: number;
  aspectRatio: string;
  refImages: ImageInput[];
  inputImage?: ImageInput;
}

export interface VideoSource {
  url: string;
  headers?: Record<string, string>;
  remoteOnly?: boolean;
}

export type PollResult =
  | { state: 'running'; progress?: number; stage?: string }
  | { state: 'done'; video: VideoSource }
  | { state: 'failed'; code: string; message: string; retryable: boolean };

export interface HealthResult {
  ok: boolean;
  reason: string;
}

export class ProviderError extends Error {
  code: string;
  retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

export interface VideoProvider {
  id: string;
  label: string;
  kind: 'api_key' | 'browser_session' | 'demo';
  credentialHint: string;
  available: boolean;
  unavailableReason?: string;
  capabilities: ProviderCapabilities;
  pollIntervalMs: number;
  validate(input: SubmitInput): string | null;
  health(credential: string): Promise<HealthResult>;
  submit(credential: string, input: SubmitInput): Promise<{ externalId: string }>;
  poll(credential: string, externalId: string): Promise<PollResult>;
  cancel(credential: string, externalId: string): Promise<void>;
}
