import { pgTable, serial, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core';

export const accounts = pgTable('accounts', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  maskedIdentifier: text('masked_identifier').notNull(),
  encryptedCredential: text('encrypted_credential').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  sessionStatus: text('session_status').notNull().default('online'),
  currentRunningJobs: integer('current_running_jobs').notNull().default(0),
  maxSlots: integer('max_slots').notNull().default(1),
  providerId: text('provider_id').notNull().default('mock'),
  cooldownUntil: timestamp('cooldown_until'),
  lastHealthCheck: timestamp('last_health_check').defaultNow(),
  healthReason: text('health_reason').default('Tài khoản sẵn sàng'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const refImages = pgTable('ref_images', {
  id: serial('id').primaryKey(),
  tag: text('tag').notNull().unique(),
  filename: text('filename').notNull(),
  dataUrl: text('data_url').notNull(),
  mimeType: text('mime_type').notNull().default('image/png'),
  fileSize: integer('file_size').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const videoJobs = pgTable('video_jobs', {
  id: text('id').primaryKey(),
  prompt: text('prompt').notNull(),
  refTags: text('ref_tags').notNull().default('[]'),
  status: text('status').notNull().default('pending'),
  progress: integer('progress').notNull().default(0),
  duration: integer('duration').notNull().default(10),
  aspectRatio: text('aspect_ratio').notNull().default('9:16'),
  accountId: integer('account_id'),
  providerId: text('provider_id').notNull().default('mock'),
  externalId: text('external_id'),
  refSnapshot: text('ref_snapshot').notNull().default('[]'),
  inputImageUrl: text('input_image_url'),
  lastProgressAt: timestamp('last_progress_at'),
  attempts: integer('attempts').notNull().default(0),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  videoUrl: text('video_url'),
  thumbnailUrl: text('thumbnail_url'),
  createdAt: timestamp('created_at').defaultNow(),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
  elapsedSeconds: integer('elapsed_seconds').notNull().default(0),
});

export const studioCards = pgTable('studio_cards', {
  id: serial('id').primaryKey(),
  posX: integer('pos_x').notNull().default(100),
  posY: integer('pos_y').notNull().default(100),
  inputImageUrl: text('input_image_url').notNull(),
  prompt: text('prompt').notNull().default(''),
  status: text('status').notNull().default('idle'),
  jobId: text('job_id'),
  videoUrl: text('video_url'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const appSettings = pgTable('app_settings', {
  id: serial('id').primaryKey(),
  concurrencyLimit: integer('concurrency_limit').notNull().default(3),
  maxRetries: integer('max_retries').notNull().default(2),
  timeoutMinutes: integer('timeout_minutes').notNull().default(15),
  autoEnqueueOnPaste: boolean('auto_enqueue_on_paste').notNull().default(true),
  defaultDuration: integer('default_duration').notNull().default(10),
  defaultAspectRatio: text('default_aspect_ratio').notNull().default('9:16'),
  defaultProviderId: text('default_provider_id').notNull().default('auto'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const systemLogs = pgTable('system_logs', {
  id: serial('id').primaryKey(),
  category: text('category').notNull(),
  message: text('message').notNull(),
  details: text('details'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const projectProgress = pgTable('project_progress', {
  id: serial('id').primaryKey(),
  stt: integer('stt').notNull(),
  feature: text('feature').notNull(),
  acceptanceCriteria: text('acceptance_criteria').notNull(),
  status: text('status').notNull().default('todo'),
  createdAt: timestamp('created_at').defaultNow(),
});
