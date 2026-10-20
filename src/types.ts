export interface Account {
  id: number;
  name: string;
  maskedIdentifier: string;
  encryptedCredential: string;
  isEnabled: boolean;
  sessionStatus: 'online' | 'offline';
  currentRunningJobs: number;
  maxSlots: number;
  lastHealthCheck?: string;
  healthReason?: string;
  createdAt: string;
}

export interface RefImage {
  id: number;
  tag: string;
  filename: string;
  dataUrl: string;
  mimeType: string;
  fileSize: number;
  createdAt: string;
}

export interface VideoJob {
  id: string;
  prompt: string;
  refTags: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
  progress: number;
  duration: number;
  aspectRatio: '9:16' | '16:9' | '1:1';
  accountId?: number;
  attempts: number;
  errorCode?: string;
  errorMessage?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  elapsedSeconds: number;
}

export interface StudioCard {
  id: number;
  posX: number;
  posY: number;
  inputImageUrl: string;
  prompt: string;
  status: 'idle' | 'generating' | 'completed' | 'failed';
  jobId?: string;
  videoUrl?: string;
  createdAt: string;
}

export interface AppSettings {
  id: number;
  concurrencyLimit: number;
  maxRetries: number;
  timeoutMinutes: number;
  autoEnqueueOnPaste: boolean;
  updatedAt: string;
}

export interface ProjectProgressItem {
  id: number;
  stt: number;
  feature: string;
  acceptanceCriteria: string;
  status: 'done' | 'doing' | 'todo';
  createdAt: string;
}

export interface OverviewState {
  counts: {
    all: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    stopped: number;
  };
  onlineAccounts: number;
  totalAccounts: number;
  concurrencyLimit?: number;
  effectiveConcurrency?: number;
  refImageCount: number;
  runningJobs: Array<{
    id: string;
    prompt: string;
    progress: number;
    elapsedSeconds: number;
    aspectRatio: string;
    duration: number;
    thumbnailUrl: string;
  }>;
  isDispatcherActive: boolean;
}
