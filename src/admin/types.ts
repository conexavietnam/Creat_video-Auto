export interface AdminMe {
  vaid: string;
  name: string;
}

export interface AdminAccount {
  id: number;
  name: string;
  maskedIdentifier: string;
  isEnabled: boolean;
  sessionStatus: 'online' | 'offline';
  healthReason: string | null;
  maxSlots: number;
  currentRunningJobs: number;
  lastHealthCheck: string | null;
}

export interface AdminProviderSettings {
  enabled: boolean;
  model: string | null;
  baseUrl: string | null;
  pricePerSecondUsd: number | null;
  notes: string | null;
  effectiveModel: string | null;
}

export interface AdminProvider {
  id: string;
  label: string;
  kind: 'api_key' | 'browser_session' | 'demo';
  credentialHint: string;
  available: boolean;
  unavailableReason: string | null;
  capabilities: {
    durations: number[];
    aspectRatios: string[];
    maxRefImages: number;
    supportsImageToVideo: boolean;
  };
  settings: AdminProviderSettings;
  accounts: AdminAccount[];
}

export interface ProviderPatch {
  enabled?: boolean;
  model?: string | null;
  baseUrl?: string | null;
  pricePerSecondUsd?: number | null;
  notes?: string | null;
}

export interface AdminSettings {
  id: number;
  concurrencyLimit: number;
  maxRetries: number;
  timeoutMinutes: number;
  autoEnqueueOnPaste: boolean;
  defaultDuration: number;
  defaultAspectRatio: '9:16' | '16:9' | '1:1';
  defaultProviderId: string;
  updatedAt: string | null;
}

export type SettingsPatch = Partial<Omit<AdminSettings, 'id' | 'updatedAt'>>;

export interface ProviderStat {
  providerId: string;
  jobs: number;
  completed: number;
  failed: number;
  successRate: number | null;
  videoSeconds: number;
  estimatedCostUsd: number | null;
  avgCompleteSeconds: number | null;
  p95CompleteSeconds: number | null;
}

export interface AdminStats {
  range: { from: string; to: string };
  totals: {
    jobs: number;
    completed: number;
    failed: number;
    stopped: number;
    pending: number;
    running: number;
    successRate: number | null;
  };
  perDay: Array<{ date: string; created: number; completed: number; failed: number }>;
  perProvider: ProviderStat[];
  perAccount: Array<{ accountId: number; name: string | null; providerId: string; jobs: number; completed: number; failed: number }>;
  topErrors: Array<{ errorCode: string; count: number; lastMessage: string | null }>;
  queue: { pending: number; running: number; oldestPendingAgeSeconds: number | null };
  retries: { jobsWithRetry: number; totalExtraAttempts: number };
}

export interface AuditItem {
  id: number;
  at: string;
  actorVaid: string;
  action: string;
  target: string | null;
  detail: unknown;
}

export interface AuditPage {
  items: AuditItem[];
  nextBefore: number | null;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
