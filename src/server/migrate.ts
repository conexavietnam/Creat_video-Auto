import { sql } from 'drizzle-orm';
import { db } from '../db/index.ts';

const statements = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id serial PRIMARY KEY,
    name text NOT NULL,
    masked_identifier text NOT NULL,
    encrypted_credential text NOT NULL,
    is_enabled boolean NOT NULL DEFAULT true,
    session_status text NOT NULL DEFAULT 'online',
    current_running_jobs integer NOT NULL DEFAULT 0,
    max_slots integer NOT NULL DEFAULT 1,
    last_health_check timestamp DEFAULT now(),
    health_reason text DEFAULT 'Tài khoản sẵn sàng',
    created_at timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS ref_images (
    id serial PRIMARY KEY,
    tag text NOT NULL UNIQUE,
    filename text NOT NULL,
    data_url text NOT NULL,
    mime_type text NOT NULL DEFAULT 'image/png',
    file_size integer NOT NULL DEFAULT 0,
    created_at timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS video_jobs (
    id text PRIMARY KEY,
    prompt text NOT NULL,
    ref_tags text NOT NULL DEFAULT '[]',
    status text NOT NULL DEFAULT 'pending',
    progress integer NOT NULL DEFAULT 0,
    duration integer NOT NULL DEFAULT 10,
    aspect_ratio text NOT NULL DEFAULT '9:16',
    account_id integer,
    attempts integer NOT NULL DEFAULT 0,
    error_code text,
    error_message text,
    video_url text,
    thumbnail_url text,
    created_at timestamp DEFAULT now(),
    started_at timestamp,
    finished_at timestamp,
    elapsed_seconds integer NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS studio_cards (
    id serial PRIMARY KEY,
    pos_x integer NOT NULL DEFAULT 100,
    pos_y integer NOT NULL DEFAULT 100,
    input_image_url text NOT NULL,
    prompt text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'idle',
    job_id text,
    video_url text,
    created_at timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    id serial PRIMARY KEY,
    concurrency_limit integer NOT NULL DEFAULT 3,
    max_retries integer NOT NULL DEFAULT 2,
    timeout_minutes integer NOT NULL DEFAULT 15,
    auto_enqueue_on_paste boolean NOT NULL DEFAULT true,
    updated_at timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS system_logs (
    id serial PRIMARY KEY,
    category text NOT NULL,
    message text NOT NULL,
    details text,
    created_at timestamp DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS project_progress (
    id serial PRIMARY KEY,
    stt integer NOT NULL,
    feature text NOT NULL,
    acceptance_criteria text NOT NULL,
    status text NOT NULL DEFAULT 'todo',
    created_at timestamp DEFAULT now()
  )`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS provider_id text NOT NULL DEFAULT 'mock'`,
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS cooldown_until timestamp`,
  `ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS provider_id text NOT NULL DEFAULT 'mock'`,
  `ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS external_id text`,
  `ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS ref_snapshot text NOT NULL DEFAULT '[]'`,
  `ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS input_image_url text`,
  `ALTER TABLE video_jobs ADD COLUMN IF NOT EXISTS last_progress_at timestamp`,
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS default_duration integer NOT NULL DEFAULT 10`,
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS default_aspect_ratio text NOT NULL DEFAULT '9:16'`,
  `ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS default_provider_id text NOT NULL DEFAULT 'auto'`,
  `CREATE INDEX IF NOT EXISTS idx_video_jobs_status_created ON video_jobs (status, created_at)`,
  `CREATE TABLE IF NOT EXISTS provider_settings (
    provider_id text PRIMARY KEY,
    enabled boolean NOT NULL DEFAULT true,
    model text,
    base_url text,
    price_per_second_usd numeric(10,4),
    notes text,
    updated_at timestamp DEFAULT now(),
    updated_by text
  )`,
  `CREATE TABLE IF NOT EXISTS admin_audit_log (
    id serial PRIMARY KEY,
    at timestamp NOT NULL DEFAULT now(),
    actor_vaid text NOT NULL,
    action text NOT NULL,
    target text,
    detail text
  )`,
  `CREATE INDEX IF NOT EXISTS idx_admin_audit_log_id_desc ON admin_audit_log (id DESC)`,
  `INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
  `SELECT setval(pg_get_serial_sequence('app_settings', 'id'), GREATEST((SELECT MAX(id) FROM app_settings), 1))`,
];

export async function migrate() {
  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}
